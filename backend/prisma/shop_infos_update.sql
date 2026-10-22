-- shop_infos_update.sql: lets a REGISTERED shop update its own details (POST /api/infos) with its own database login. Run it once, as the owner of the database.
--
-- Why it is needed. create_tenant() gives a shop's login the right to update its own row of `tenants` ONLY while the row's expiry is still empty (that is
-- the registration, POST /api/register: the policy `tenant_update_<role>`). Once the shop is registered its expiry is set, so that policy no longer lets
-- the login update anything: POST /api/infos would find no row to update and answer 500 NOT_UPDATED.
--
-- What it adds
--   1. A trigger that stops a shop login from ever changing its expiry after registration. This matters: row-level-security policies are OR-ed, so the new
--      policy below must not become a way for a shop to give itself a longer licence. (Only the owner, or you in a SQL console, can move an expiry.)
--   2. For every shop that already exists, a second UPDATE policy `tenant_update_infos_<role>`: the login may update ITS OWN row while its licence is
--      running (expiry set and not past). The columns it may update are the ones already granted by create_tenant(): name, phone, email, address,
--      instagram_url, tiktok_url (and expiry, which the trigger now protects). The key and the host are not in the grant, so they can never change.
--
-- New shops: create_tenant() makes this policy itself (and this trigger), so this file is only for the shops that existed before that change.
-- The file can be run again at any time: it replaces what it made.

-- 1. a shop login can not change its expiry once the shop is registered
CREATE OR REPLACE FUNCTION tenants_shop_login_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF session_user LIKE 'tenant\_%' AND OLD.expiry IS NOT NULL AND NEW.expiry IS DISTINCT FROM OLD.expiry THEN
    RAISE EXCEPTION 'A shop cannot change its own expiry.' USING ERRCODE = '42501';
END IF;
RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenants_shop_login_guard ON tenants;
CREATE TRIGGER tenants_shop_login_guard BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION tenants_shop_login_guard();

-- 2. the policy, for every shop that exists (the login is named after the shop's key, see create_tenant())
DO $$
DECLARE
t      record;
  v_role text;
BEGIN
FOR t IN SELECT key FROM tenants LOOP
    v_role := 'tenant_' || replace(t.key, '-', '');
IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON tenants', 'tenant_update_infos_' || v_role);
EXECUTE format(
        'CREATE POLICY %I ON tenants FOR UPDATE TO %I USING (key = %L AND expiry IS NOT NULL AND expiry::date >= (now() AT TIME ZONE ''UTC'')::date) WITH CHECK (key = %L)',
        'tenant_update_infos_' || v_role, v_role, t.key, t.key
        );
END IF;
END LOOP;
END;
$$;
