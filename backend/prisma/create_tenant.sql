-- create_tenant(): registers a new shop and gives it its own database login.
--
--   SELECT create_tenant(
--     'maison-clair.example.com',                              -- host   : the address the shop's website is served from
--     'ep-xxxx-pooler.c-8.eu-central-1.aws.neon.tech'          -- server : the address the app connects to
--   );
--   -> postgresql://tenant_0ad726ca55c3479787fe5b22f4d5d035:0ad726ca-55c3-4797-87fe-22b5f334d035@ep-xxxx.../neondb?sslmode=require

-- What it does, in one transaction (all or nothing):
--   1. inserts the shop into tenants (its host; the name is the host for now, the shop's real name and details are written by POST /api/register when
--      the shop activates its copy; the expiry stays empty until then) and reads back the key the database generated for it;
--   2. creates ONE login role named after the key, with the key itself as its password (this is the only role: the
--      desktop app and the shop's website server both connect with it);
--   3. GRANT CONNECT on this database and USAGE on schema public;
--   4. categories: SELECT only (they are the same for every shop; no policy);
--      tenants:    SELECT, and UPDATE of the shop's details (name, phone, email, address, instagram_url, tiktok_url) and of its expiry
--                  (never the key or the host), each with a row-level-security policy:
--                    - SELECT: the role reads ONLY ITS OWN ROW (key = its key);
--                    - UPDATE: the role may update ONLY ITS OWN ROW, and only while its expiry is still empty (the shop has never been registered:
--                      this is what POST /api/register does, once). WITH CHECK keeps the key its own and lets the expiry be set only to a day no
--                      later than today + 15, so the role cannot give itself a longer licence;
--                    - UPDATE (second policy): once registered, while its licence is running (expiry set and not past), the role may update ONLY ITS OWN
--                      ROW: this is what POST /api/infos does, and POST /api/register for a shop that already has a day (its details, with the columns granted above; the expiry stays). The key and the host are not in the
--                      grant. A trigger (tenants_shop_login_guard, created by this file) stops a shop login from ever changing its expiry once it is set,
--                      because policies are OR-ed and this one would otherwise let a shop extend its own licence;
--   5. on every other public table that has a text tenant_key column: grants SELECT, INSERT, UPDATE and DELETE (and
--      USAGE on the table's id sequence, if it has one) and creates a row-level-security policy so the role only
--      sees and writes rows carrying its own key. DELETE is NOT granted on the tables whose rows must never be
--      deleted (the money trail and its numbering): orders, order_items, supplier_orders, supplier_order_items, payments, invoices,
--      invoice_items and number_sequences. They get SELECT, INSERT and UPDATE only (cancel or void them with a status instead);
--   6. a SECOND login for the shop, READ-ONLY (for the public pages, later): tenantro_<key without dashes>, with the same key as its password. It may connect and use
--      the schema, and has SELECT on the tables orders, order_items and payments and nothing else (the lines and the payments of an order are read with it), each with a row-level-security policy
--      (tenant_ro_select_<role>, FOR SELECT only) that lets it read ONLY the rows of its own shop (tenant_key = its key). It can not insert, update or delete anything,
--      and it sees no other table. (Its name starts with "tenantro_", not
--      "tenant_", so nothing that looks for the shops' logins by "tenant\_%" takes it for a shop.)
--   7. returns the connection URL for the shop's normal login (this is the app's `database.url`).
--
-- Notes
--   * Run it as a role that may create roles (the owner). The URL contains the password: treat it as a secret.
--   * The server address can't be known from inside Postgres, so it is passed in.
--   * Shops that existed before this function have policies that apply to every login: run
--     limit_existing_policies.sql once, before adding a second shop.

-- A shop login can not change its expiry once the shop is registered (see step 4 above and shop_infos_update.sql). Safe to run again; it is per table, not per shop.
CREATE OR REPLACE FUNCTION tenants_shop_login_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $guard$
BEGIN
  IF session_user LIKE 'tenant\_%' AND OLD.expiry IS NOT NULL AND NEW.expiry IS DISTINCT FROM OLD.expiry THEN
    RAISE EXCEPTION 'A shop cannot change its own expiry.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$guard$;

DROP TRIGGER IF EXISTS tenants_shop_login_guard ON tenants;
CREATE TRIGGER tenants_shop_login_guard BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION tenants_shop_login_guard();

DROP FUNCTION IF EXISTS create_backend_role(text, text);
DROP FUNCTION IF EXISTS create_tenant(text, text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS create_tenant(text, text);

CREATE OR REPLACE FUNCTION create_tenant(
  p_host          text,
  p_server        text
) RETURNS text
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
v_key  text;
  v_role text;
  v_db   text := current_database();
  t      record;
  v_seq  text;
  v_privs text;
  v_ro text;
  v_read_table text;
  -- the tables the read-only login may read (SELECT only, its own shop's rows)
  v_read_tables constant text[] := ARRAY['orders', 'order_items', 'payments'];
  -- rows of these tables are never deleted
  v_keep constant text[] := ARRAY['orders', 'order_items', 'supplier_orders', 'supplier_order_items', 'payments', 'invoices', 'invoice_items', 'number_sequences'];
BEGIN

  IF coalesce(btrim(p_host), '') = '' THEN RAISE EXCEPTION 'host (the address the shop''s website is served from) is required'; END IF;
  IF coalesce(btrim(p_server), '') = '' THEN RAISE EXCEPTION 'server (the address the app connects to) is required'; END IF;

  -- 1. the shop; the key is generated by the table's default and read back. The name is the host until the shop registers (tenants.name cannot be empty);
  --    the expiry stays empty: only POST /api/register accepts a shop in that state, and it sets the real name, the details and the expiry.
INSERT INTO tenants (host, name)
VALUES (btrim(p_host), btrim(p_host))
    RETURNING key INTO v_key;

IF v_key IS NULL THEN
    RAISE EXCEPTION 'tenants.key has no default value, so no key was generated';
END IF;

  -- 2. the login: named after the key, the key is its password
  v_role := 'tenant_' || replace(v_key, '-', '');
EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', v_role, v_key);

-- 3. the grants
EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', v_db, v_role);
EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', v_role);

-- 4. categories: read only, the same for every shop.
--    tenants: the shop reads its own row. POST /api/register runs as this role: it may update its own row's details and its expiry (the columns
--    below, never the key or the host), but only while the expiry is still empty, and only to a day no later than today + 15 (UTC). The policies:
--      SELECT  USING (key = its key)
--      UPDATE  USING (key = its key AND expiry IS NULL)
--              WITH CHECK (key = its key AND expiry IS NOT NULL AND expiry::date <= today + 15)
EXECUTE format('GRANT SELECT ON categories TO %I', v_role);
EXECUTE format('GRANT SELECT ON tenants TO %I', v_role);
EXECUTE format('CREATE POLICY %I ON tenants FOR SELECT TO %I USING (key = %L)', 'tenant_select_' || v_role, v_role, v_key);
EXECUTE format('GRANT UPDATE (name, phone, email, address, instagram_url, tiktok_url, expiry) ON tenants TO %I', v_role);
EXECUTE format(
        'CREATE POLICY %I ON tenants FOR UPDATE TO %I USING (key = %L AND expiry IS NULL) WITH CHECK (key = %L AND expiry IS NOT NULL AND expiry::date <= (now() AT TIME ZONE ''UTC'')::date + 15)',
        'tenant_update_' || v_role, v_role, v_key, v_key
        );
--      UPDATE (second policy, POST /api/infos): USING (key = its key AND expiry IS NOT NULL AND expiry::date >= today)  WITH CHECK (key = its key)
EXECUTE format(
        'CREATE POLICY %I ON tenants FOR UPDATE TO %I USING (key = %L AND expiry IS NOT NULL AND expiry::date >= (now() AT TIME ZONE ''UTC'')::date) WITH CHECK (key = %L)',
        'tenant_update_infos_' || v_role, v_role, v_key, v_key
        );

-- 5. the shop's tables (every other public table with a text tenant_key column): the id sequence where there
--    is one, and row-level security so this role sees and writes only rows carrying its own key. The policy is
--    named after the role and limited to it (TO), so several shops can live side by side without seeing each other.
FOR t IN
SELECT c.table_schema, c.table_name
FROM information_schema.columns c
         JOIN information_schema.tables tb
              ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
WHERE c.column_name = 'tenant_key'
  AND c.table_schema = 'public'
  AND c.udt_name = 'text'
    LOOP
    v_privs := CASE WHEN t.table_name = ANY (v_keep) THEN 'SELECT, INSERT, UPDATE' ELSE 'SELECT, INSERT, UPDATE, DELETE' END;
EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', t.table_schema, t.table_name);
EXECUTE format('GRANT %s ON %I.%I TO %I', v_privs, t.table_schema, t.table_name, v_role);
-- a table whose id comes from a sequence (brands) needs it to insert
v_seq := pg_get_serial_sequence(format('%I.%I', t.table_schema, t.table_name), 'id');
    IF v_seq IS NOT NULL THEN
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO %I', v_seq, v_role);
END IF;

EXECUTE format(
        'CREATE POLICY %I ON %I.%I FOR ALL TO %I USING (tenant_key = %L) WITH CHECK (tenant_key = %L)',
        'tenant_isolation_' || v_role, t.table_schema, t.table_name, v_role, v_key, v_key
        );
END LOOP;

  -- 6. the read-only login: it can read the orders, the order lines and the payments of its own shop and nothing else. (All three tables already have row-level security on:
  --    step 5 did it, as all have a text tenant_key.)
  v_ro := 'tenantro_' || replace(v_key, '-', '');
EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', v_ro, v_key);
EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', v_db, v_ro);
EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', v_ro);
FOREACH v_read_table IN ARRAY v_read_tables LOOP
  EXECUTE format('GRANT SELECT ON %I TO %I', v_read_table, v_ro);
  EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO %I USING (tenant_key = %L)', 'tenant_ro_select_' || v_ro, v_read_table, v_ro, v_key);
END LOOP;

  -- 7. the connection URL
RETURN format('postgresql://%s:%s@%s/%s?sslmode=require', v_role, v_key, btrim(p_server), v_db);
END;
$$;

-- Not for everyone: only the role that owns the database should be able to call it.
REVOKE ALL ON FUNCTION create_tenant(text, text) FROM PUBLIC;
