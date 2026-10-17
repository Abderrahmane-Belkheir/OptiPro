-- Everything the database needs for the backend to run, in one script:
--   1. the columns added to older tables, and the customers table (databases created before it
--      was added don't have it),
--   2. the privileges the backend's role needs,
--   3. row-level security (RLS) that isolates tenants, enforced by Postgres itself.
--
-- RUN ONCE, as the table owner (neondb_owner, e.g. in the Neon SQL editor) — the backend's own role
-- can't. Safe to re-run. It's a single transaction: if anything fails, nothing is applied.
--
-- BEFORE RUNNING:
--   * put the role from the backend's DATABASE_URL on the set_config line below;
--   * the shop-management tables (prescriptions, lenses, orders, order_items, payments, invoices,
--     invoice_items, number_sequences) must exist — create them from prisma/schema.prisma, e.g.
--       npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
--     The script stops with a clear error if any is missing.
--
-- What the role gets:
--   SELECT                  every table below (every read route), plus categories and tenants
--   INSERT, UPDATE, DELETE  the twelve tenant-owned tables:
--                             brands, frames, accessories, customers,
--                             prescriptions, lenses, orders, order_items,
--                             payments, invoices, invoice_items, number_sequences
--                           (INSERT is what POST /api/tables/:table uses; DELETE is the DELETE route.
--                           To make financial records undeletable, revoke DELETE on payments,
--                           invoices and invoice_items — the DELETE route then answers 500 for them.)
--   USAGE                   the brands.id sequence (brands.id is a serial), and the public schema
--   Not granted: TRUNCATE (it bypasses RLS entirely, so it would let the role wipe EVERY tenant's
--   rows), any write on categories/tenants (the API treats them as read-only — now the database
--   does too), CREATE or anything on other schemas.
--   With RLS, UPDATE and DELETE only reach the tenant's own rows, and an UPDATE can't hand a row to
--   another tenant (the policy's WITH CHECK rejects the new tenant_key).
--
-- How RLS works: the backend wraps every query on a tenant-owned table in a transaction that first
-- runs   SELECT set_config('app.tenant_key', '<tenant key>', true)   (src/lib/tenantContext.js,
-- withTenant). The policies only let a role see or write rows whose tenant_key equals that setting;
-- with it unset, empty or wrong, a role sees nothing — it fails closed. WITH CHECK is what stops a
-- tenant inserting rows for another tenant.
--
-- Foreign keys are NOT covered by RLS: Postgres checks them without it. So a row can point at
-- another tenant's row (an order at someone else's customer) unless the backend refuses first —
-- see TENANT_OWNED_REFERENCES in src/services/tableService.js.
--
-- RLS does NOT apply to a table's owner, a superuser, or a BYPASSRLS role, so the backend must
-- connect as a separate role (the check below warns if it doesn't). It's deliberately left off:
--   categories  global, no tenant column.
--   tenants     the registry: the backend reads it (host -> key, "does this key exist") before any
--               tenant is known, so a key-based policy would lock it out.
--
-- The last query lists the result: every tenant-owned table should show "rls on" = true and
-- select/insert/update/delete all true; categories and tenants only "can select".

BEGIN;

-- >>> EDIT THIS: the role in the backend's DATABASE_URL.
SELECT set_config('app.setup_role', 'backend', false);

-- 1. Older tables ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenant_key" TEXT NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "customers_tenant_key_fkey" FOREIGN KEY ("tenant_key") REFERENCES "tenants"("key") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Columns added since those tables were first created.
ALTER TABLE "customers"   ADD COLUMN IF NOT EXISTS "date_of_birth" TIMESTAMP(3);
ALTER TABLE "accessories" ADD COLUMN IF NOT EXISTS "cost_price" DOUBLE PRECISION;
ALTER TABLE "frames"      ADD COLUMN IF NOT EXISTS "eye_size" INTEGER;
ALTER TABLE "frames"      ADD COLUMN IF NOT EXISTS "bridge" INTEGER;
ALTER TABLE "frames"      ADD COLUMN IF NOT EXISTS "temple_length" INTEGER;
ALTER TABLE "frames"      ADD COLUMN IF NOT EXISTS "reference" TEXT;
ALTER TABLE "frames"      ADD COLUMN IF NOT EXISTS "cost_price" DOUBLE PRECISION;

-- The shop-management tables must already exist.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(t, ', ') INTO missing
  FROM unnest(ARRAY['prescriptions', 'lenses', 'orders', 'order_items', 'payments', 'invoices', 'invoice_items', 'number_sequences']) AS t
  WHERE to_regclass('public.' || t) IS NULL;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Missing table(s): %. Create them from prisma/schema.prisma first (see the top of this script).', missing;
  END IF;
END $$;

-- 2. Privileges ------------------------------------------------------------------------------

DO $$
DECLARE
  app_role text := current_setting('app.setup_role');
  tenant_tables text[] := ARRAY[
    'brands', 'frames', 'accessories', 'customers',
    'prescriptions', 'lenses', 'orders', 'order_items',
    'payments', 'invoices', 'invoice_items', 'number_sequences'
  ];
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    RAISE EXCEPTION 'Role "%" does not exist. Set it on the set_config line at the top of this script.', app_role;
  END IF;

  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', app_role);
  EXECUTE format('GRANT SELECT ON categories, tenants TO %I', app_role);
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO %I', t, app_role);
  END LOOP;
  EXECUTE format('GRANT USAGE ON SEQUENCE brands_id_seq TO %I', app_role);

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role AND (rolsuper OR rolbypassrls))
     OR EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tableowner = app_role) THEN
    RAISE WARNING 'Role "%" owns tables or bypasses RLS, so the policies below will NOT apply to it. Use a separate, non-owner role.', app_role;
  END IF;
END $$;

-- 3. Row-level security ----------------------------------------------------------------------

DO $$
DECLARE
  tenant_tables text[] := ARRAY[
    'brands', 'frames', 'accessories', 'customers',
    'prescriptions', 'lenses', 'orders', 'order_items',
    'payments', 'invoices', 'invoice_items', 'number_sequences'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I
         USING (tenant_key = current_setting(''app.tenant_key'', true))
         WITH CHECK (tenant_key = current_setting(''app.tenant_key'', true))', t);
  END LOOP;
END $$;

COMMIT;

-- Result ---------------------------------------------------------------------------------------

SELECT c.relname AS "table",
       c.relrowsecurity AS "rls on",
       has_table_privilege(current_setting('app.setup_role'), c.oid, 'SELECT') AS "can select",
       has_table_privilege(current_setting('app.setup_role'), c.oid, 'INSERT') AS "can insert",
       has_table_privilege(current_setting('app.setup_role'), c.oid, 'UPDATE') AS "can update",
       has_table_privilege(current_setting('app.setup_role'), c.oid, 'DELETE') AS "can delete"
FROM pg_class c
WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
ORDER BY c.relname;

-- To undo the privileges and RLS (the tables and columns are left in place), for each tenant table
-- (brands, frames, accessories, customers, prescriptions, lenses, orders, order_items, payments,
-- invoices, invoice_items, number_sequences):
--   DROP POLICY tenant_isolation ON <table>;   ALTER TABLE <table> DISABLE ROW LEVEL SECURITY;
--   REVOKE ALL ON <table> FROM backend;
-- and:
--   REVOKE ALL ON categories, tenants FROM backend;
--   REVOKE USAGE ON SEQUENCE brands_id_seq FROM backend;
