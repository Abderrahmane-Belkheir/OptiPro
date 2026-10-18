-- One-time fix for shops created before create_tenant() existed.
--
-- Their `tenant_isolation` policies have no TO clause, so they apply to EVERY login. With a second shop
-- in the database, policies on a table are combined with OR, and each shop would see the other's rows.
-- This limits each such policy to the one role that belongs to its shop:
--
--   * the role create_tenant() made for that key:  tenant_<key without dashes>, or
--   * for a shop whose login was made by hand, the role named in legacy_role below.
--
-- Safe to run again: it only touches policies that still apply to everyone, and it stops (changing
-- nothing, the whole block is one transaction) if it can't find the role a policy should belong to.
-- Run it as the owner of the tables.

DO $$
DECLARE
  legacy_role text := 'client1';   -- the hand-made login of the first shop; change if yours is named differently
  p        record;
  v_key    text;
  v_role   text;
  n        int := 0;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname, qual
    FROM pg_policies
    WHERE schemaname = 'public'
      AND roles = '{public}'                          -- no TO clause: applies to every login
      AND qual ~ 'tenant_key = ''[^'']+'''            -- ... and it is a per-shop policy
  LOOP
    v_key  := substring(p.qual FROM 'tenant_key = ''([^'']+)''');
    v_role := 'tenant_' || replace(v_key, '-', '');

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      v_role := legacy_role;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
        RAISE EXCEPTION 'No login found for the shop % (looked for tenant_% and %): policy % on % left unchanged',
          v_key, replace(v_key, '-', ''), legacy_role, p.policyname, p.tablename;
      END IF;
    END IF;

    EXECUTE format('ALTER POLICY %I ON %I.%I TO %I', p.policyname, p.schemaname, p.tablename, v_role);
    n := n + 1;
  END LOOP;

  RAISE NOTICE '% policy(ies) limited to their shop''s role', n;
END
$$;

-- Check: nothing should be listed here any more.
--   SELECT tablename, policyname, roles FROM pg_policies WHERE schemaname = 'public' AND roles = '{public}';
