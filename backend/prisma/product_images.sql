-- product_images: the photo codes (file names) of a shop's products.
--
-- One row per photo: a random uuid id, the shop (tenant_key), the photo's code (the file name the
-- upload endpoint stored it under: <IMAGES_DIR>/<tenant key>/<code>), and the product it belongs to:
-- EITHER a frame (frame_id) OR an accessory (accessory_id), never both and never neither.
-- A code is unique within a shop: uploading the same code again replaces the photo, so it is the same row.
--
-- Run as the owner of the tables (the Neon SQL editor). Safe to run again, also if an earlier version of
-- this table (without the two product columns) already exists.

CREATE TABLE IF NOT EXISTS product_images (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key   text NOT NULL REFERENCES tenants (key) ON DELETE CASCADE ON UPDATE CASCADE,
  code         text NOT NULL,
  frame_id     text REFERENCES frames (id) ON DELETE CASCADE ON UPDATE CASCADE,
  accessory_id text REFERENCES accessories (id) ON DELETE CASCADE ON UPDATE CASCADE,
  -- the same rule the upload endpoint applies to a code: plain characters, no slashes, not hidden
  CONSTRAINT product_images_code_check CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'),
  -- exactly one of the two product columns is filled
  CONSTRAINT product_images_one_product_check CHECK (num_nonnulls(frame_id, accessory_id) = 1),
  CONSTRAINT product_images_tenant_code_key UNIQUE (tenant_key, code)
);

-- For a table made by an earlier version: add what is missing (the table has no rows of value yet; if it
-- does, fill frame_id or accessory_id on them first, or the check below is refused).
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS frame_id text REFERENCES frames (id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS accessory_id text REFERENCES accessories (id) ON DELETE CASCADE ON UPDATE CASCADE;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_images_one_product_check') THEN
    ALTER TABLE product_images ADD CONSTRAINT product_images_one_product_check CHECK (num_nonnulls(frame_id, accessory_id) = 1);
  END IF;
END
$$;

-- Finding a product's photos (and keeping deletes of a product fast).
CREATE INDEX IF NOT EXISTS product_images_frame_id_idx ON product_images (frame_id) WHERE frame_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_images_accessory_id_idx ON product_images (accessory_id) WHERE accessory_id IS NOT NULL;

-- Row-level security: on, so a login only ever sees and writes its own shop's rows.
ALTER TABLE product_images ENABLE ROW LEVEL SECURITY;

-- The shop's login: its role, and the tenant key that role belongs to.
-- (create_tenant() names the role tenant_<key without dashes>; change both lines for another shop.)
DO $$
DECLARE
  v_role text := 'tenant_2142e2f9011f442fac5c6498394d9de2';
  v_key  text := '2142e2f9-011f-442f-ac5c-6498394d9de2';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
    RAISE EXCEPTION 'The role % does not exist', v_role;
  END IF;

  -- what the role may do with the table (the policy below only narrows it to the shop's own rows)
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON product_images TO %I', v_role);

  -- the policy: for ALL commands, limited to this role, only rows of this shop, for reading and writing
  EXECUTE format('DROP POLICY IF EXISTS %I ON product_images', 'tenant_isolation_' || v_role);
  EXECUTE format(
    'CREATE POLICY %I ON product_images FOR ALL TO %I USING (tenant_key = %L) WITH CHECK (tenant_key = %L)',
    'tenant_isolation_' || v_role, v_role, v_key, v_key
  );
END
$$;

-- Check: one policy, limited to the role, and RLS on.
--   SELECT policyname, roles, cmd, qual FROM pg_policies WHERE tablename = 'product_images';
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'product_images';
--
-- New shops: create_tenant() already covers this table (it grants and adds a policy on every public table
-- that has a text tenant_key column), so nothing more is needed for them.
--
-- Note: Postgres checks a foreign key with the table owner's rights, so row-level security does not stop a
-- row pointing at ANOTHER shop's frame id (the same is true of every table that points at frames). The
-- app only ever writes ids it just read for its own shop.
