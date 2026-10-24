-- Supplier orders: run this ONCE on the database (as the owner role), for the shops that already exist. Safe to run again.
-- A shop created after this by create_tenant() gets the same access by itself (it grants every table with a text tenant_key column).
-- Run suppliers_and_costs.sql first (it makes the suppliers table that these tables point at).
--
--   supplier_orders         an order placed with a supplier for frames and accessories      (never deleted: cancelled with its status)
--   supplier_order_items    one frame or accessory of it: quantity and what ONE cost        (never deleted)
--
-- Money is in minor units (centimes), like the other tables. Needs suppliers, frames and accessories to exist, with a text id.

CREATE TABLE IF NOT EXISTS supplier_orders (
  id           text PRIMARY KEY,
  supplier_id  text NOT NULL REFERENCES suppliers (id) ON DELETE RESTRICT,
  ordered_at   timestamptz NOT NULL DEFAULT now(),
  price_mode   text NOT NULL DEFAULT 'unit',      -- unit | batch
  total_cents  integer NOT NULL DEFAULT 0,
  status       text NOT NULL DEFAULT 'received',  -- received | cancelled
  notes        text,
  tenant_key   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_orders_tenant_key_ordered_at_idx ON supplier_orders (tenant_key, ordered_at);
CREATE INDEX IF NOT EXISTS supplier_orders_supplier_id_idx ON supplier_orders (supplier_id);

CREATE TABLE IF NOT EXISTS supplier_order_items (
  id                 text PRIMARY KEY,
  supplier_order_id  text NOT NULL REFERENCES supplier_orders (id) ON DELETE CASCADE,
  frame_id           text REFERENCES frames (id),
  accessory_id       text REFERENCES accessories (id),
  quantity           integer NOT NULL DEFAULT 1,
  unit_cost_cents    integer NOT NULL,
  used               boolean NOT NULL DEFAULT false,  -- true when this line set the frame's stock and cost (the frame was at stock 0)
  tenant_key         text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_order_items_supplier_order_id_idx ON supplier_order_items (supplier_order_id);
CREATE INDEX IF NOT EXISTS supplier_order_items_frame_id_idx ON supplier_order_items (frame_id);

-- Row-level security and the grants, for every shop that exists already: the same as create_tenant() does (a shop sees and writes only its own rows;
-- the orders and their lines are never deleted).
DO $$
DECLARE
  t record;
  v_role text;
  v_table text;
BEGIN
  FOR v_table IN SELECT unnest(ARRAY['supplier_orders', 'supplier_order_items']) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_table);
  END LOOP;

  FOR t IN SELECT key::text AS key FROM tenants LOOP
    v_role := 'tenant_' || replace(t.key, '-', '');
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role);
    FOR v_table IN SELECT unnest(ARRAY['supplier_orders', 'supplier_order_items']) LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO %I', v_table, v_role);
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = v_table AND policyname = 'tenant_isolation_' || v_role) THEN
        EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO %I USING (tenant_key = %L) WITH CHECK (tenant_key = %L)',
          'tenant_isolation_' || v_role, v_table, v_role, t.key, t.key);
      END IF;
    END LOOP;
  END LOOP;
END $$;
