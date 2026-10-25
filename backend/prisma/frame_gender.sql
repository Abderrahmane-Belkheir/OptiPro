-- A frame's gender: who it is for. Run once on the database (Neon), BEFORE the new server and the new desktop app are deployed:
--   * the table API (desktop app -> server) writes it, so the server's column list knows it (scripts/sync-table-api.mjs wrote that from the desktop's schema);
--   * the website reads it (GET /api/frames, /api/frames/:code) for its Male / Female / Unisex filter.
-- Lower case only, and only these three values (or empty): the desktop app stores them that way and refuses anything else.
-- Safe to run again.

ALTER TABLE frames ADD COLUMN IF NOT EXISTS gender text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'frames_gender_check') THEN
    ALTER TABLE frames ADD CONSTRAINT frames_gender_check CHECK (gender IS NULL OR gender IN ('male', 'female', 'unisex'));
  END IF;
END $$;

-- Nothing else to do: the shops' logins (create_tenant) have table-level rights on frames, so they take the new column, and their row-level policies are unchanged.
