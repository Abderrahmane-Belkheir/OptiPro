-- Run ONCE on the database (as the owner role), for the shops that already exist. Safe to run again.
-- A shop created later by create_tenant() gets the same access by itself (it grants every table with a text tenant_key column).
--
--   1. suppliers: who the shop buys from (the app's Suppliers page).
--   2. order_items.unit_cost_cents: what one unit cost the shop on the day of the sale (the net profit of the Orders page).
--   3. orders: the measurements written on the order (pd and fitting heights, right and left).
--
-- Without 1 and 2 the app's sync says: There is no table "suppliers" / unitCostCents is not a column of "order_items".

CREATE TABLE IF NOT EXISTS suppliers (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  kinds         text NOT NULL DEFAULT '',   -- a comma-separated list of: lenses, frames, accessories, other
  contact_name  text,
  phone         text,
  email         text,
  address       text,
  notes         text,
  is_active     boolean NOT NULL DEFAULT true,
  tenant_key    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS suppliers_tenant_key_name_idx ON suppliers (tenant_key, name);

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS unit_cost_cents integer;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS pd_right double precision;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pd_left double precision;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fitting_height_right double precision;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fitting_height_left double precision;

-- Row-level security and the grants on suppliers, for every shop that exists already: what create_tenant() does (a shop sees and writes only its own rows).
DO $$
DECLARE
  t record;
  v_role text;
BEGIN
  ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
  FOR t IN SELECT key::text AS key FROM tenants LOOP
    v_role := 'tenant_' || replace(t.key, '-', '');
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON suppliers TO %I', v_role);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'suppliers' AND policyname = 'tenant_isolation_' || v_role) THEN
      EXECUTE format('CREATE POLICY %I ON suppliers FOR ALL TO %I USING (tenant_key = %L) WITH CHECK (tenant_key = %L)',
        'tenant_isolation_' || v_role, v_role, t.key, t.key);
    END IF;
  END LOOP;
END $$;
