import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/sqlite-client";
import { appDataDir } from "./appData";

function resolveDbPath(): string {
  // SQLITE_DATABASE_URL overrides the default — useful for tests/dev without touching the real
  // app data folder. Otherwise the db lives under the OS's per-app data directory, e.g. on
  // Windows: %APPDATA%/OptiPro/local.db.
  const override = process.env.SQLITE_DATABASE_URL;
  if (override) {
    return override.startsWith("file:") ? override.slice("file:".length) : override;
  }
  return path.join(appDataDir(), "local.db");
}

/**
 * The raw CREATE TABLE statements for prisma/sqlite/schema.prisma. `npm run build` generates them
 * (scripts/generate-db.mjs) and copies them next to the compiled code (scripts/copy-prisma-client.mjs).
 */
function readInitSql(): string {
  const initSqlPath = path.join(__dirname, "..", "generated", "sqlite-init.sql");
  try {
    return fs.readFileSync(initSqlPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`The database script ${initSqlPath} is missing. Rebuild the app with "npm run build".`);
    }
    throw err;
  }
}

/**
 * Columns added to a table after it was first created. CREATE TABLE IF NOT EXISTS leaves an
 * existing table alone, so an install made before a column existed gets it added here. Each entry
 * is a column's definition exactly as it appears in init.sql.
 */
const ADDED_COLUMNS: { table: string; column: string; definition: string }[] = [
  ...["brands", "frames", "accessories", "customers"].map((table) => ({
    table,
    column: "synced",
    definition: "BOOLEAN NOT NULL DEFAULT false",
  })),
  { table: "product_images", column: "synced", definition: "BOOLEAN NOT NULL DEFAULT false" },
  { table: "frames", column: "eye_size", definition: "INTEGER" },
  { table: "frames", column: "bridge", definition: "INTEGER" },
  { table: "frames", column: "temple_length", definition: "INTEGER" },
  { table: "frames", column: "reference", definition: "TEXT" },
  { table: "frames", column: "cost_price", definition: "REAL" },
  { table: "accessories", column: "cost_price", definition: "REAL" },
  { table: "frames", column: "code", definition: "TEXT" },
  { table: "accessories", column: "code", definition: "TEXT" },
  { table: "customers", column: "date_of_birth", definition: "DATETIME" },
  { table: "lenses", column: "polarized", definition: "BOOLEAN NOT NULL DEFAULT false" },
  { table: "lenses", column: "tint", definition: "TEXT" },
  { table: "lenses", column: "sphere_min", definition: "REAL" },
  { table: "lenses", column: "sphere_max", definition: "REAL" },
  { table: "lenses", column: "cylinder_min", definition: "REAL" },
  { table: "lenses", column: "cylinder_max", definition: "REAL" },
  { table: "lenses", column: "add_min", definition: "REAL" },
  { table: "lenses", column: "add_max", definition: "REAL" },
  { table: "lenses", column: "combined_limit", definition: "REAL" },
  { table: "lenses", column: "lead_time_days", definition: "INTEGER" },
  { table: "lenses", column: "min_fitting_height", definition: "REAL" },
  { table: "lenses", column: "brand", definition: "TEXT" },
  { table: "lenses", column: "reference", definition: "TEXT" },
  { table: "lenses", column: "notes", definition: "TEXT" },
  { table: "prescriptions", column: "pd_right", definition: "REAL" },
  { table: "prescriptions", column: "pd_left", definition: "REAL" },
  { table: "prescriptions", column: "fitting_height_right", definition: "REAL" },
  { table: "prescriptions", column: "fitting_height_left", definition: "REAL" },
];

function addMissingColumns(db: Database.Database): void {
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const existing = db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[];
    if (existing.length === 0) continue; // the table is not there yet (a new database): the schema script creates it with the column
    if (!existing.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`);
    }
  }
}

/**
 * The id a brand gets when a database that numbered its brands is converted: made from the shop and the name, so the same brand gets the
 * same id on every computer and on the server (whose conversion script computes it the same way: md5(tenant_key || ':' || name) as a uuid),
 * with nobody having to agree on anything. A brand made after the conversion gets an ordinary random UUID.
 */
export function brandIdFor(tenantKey: string, name: string): string {
  const hex = createHash("md5").update(`${tenantKey}:${name}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Brands used to be numbered (1, 2, 3, ... with the server's own number kept apart in remote_id). Now a brand's id is a UUID like every other
 * table's. A database that still has the numbers is converted ONCE: every brand gets its id from its shop and name (see brandIdFor), the
 * frames that point at a brand are pointed at its new id, and the remote_id column goes. Deletions of brands that were still waiting for the
 * server are dropped: they were addressed by the server's old numbers. Both tables are rebuilt (SQLite cannot change a column's type), in
 * one transaction. Returns whether it converted anything (false on a new database and on one that is already converted).
 */
function convertBrandIdsToUuids(db: Database.Database, initSql: string): boolean {
  const brandColumns = db.prepare(`PRAGMA table_info("brands")`).all() as { name: string; type: string }[];
  const idColumn = brandColumns.find((c) => c.name === "id");
  if (!idColumn || idColumn.type.toUpperCase() !== "INTEGER") return false; // no brands table yet, or already converted
  const create = (table: string) => initSql.match(new RegExp(`CREATE TABLE "${table}" \\([\\s\\S]*?\\n\\);`))?.[0];
  const brandsSql = create("brands");
  const framesSql = create("frames");
  if (!brandsSql || !framesSql) throw new Error("The schema script has no brands or frames table.");

  db.pragma("foreign_keys = OFF"); // tables that are dropped and renamed must not trigger the rules of the tables that refer to them
  try {
    db.transaction(() => {
      const brands = db.prepare(`SELECT id, name, tenant_key AS tenantKey, synced FROM "brands"`).all() as { id: number; name: string; tenantKey: string; synced: number }[];
      db.exec(`CREATE TEMP TABLE "_brand_map" ("old" INTEGER PRIMARY KEY, "new" TEXT NOT NULL)`);
      const map = db.prepare(`INSERT INTO "_brand_map" ("old", "new") VALUES (?, ?)`);
      for (const b of brands) map.run(b.id, brandIdFor(b.tenantKey, b.name));

      db.exec(brandsSql.replace('CREATE TABLE "brands"', 'CREATE TABLE "brands_new"'));
      db.exec(`INSERT INTO "brands_new" ("id", "name", "synced", "tenant_key") SELECT m."new", b."name", b."synced", b."tenant_key" FROM "brands" b JOIN "_brand_map" m ON m."old" = b."id"`);
      db.exec(`DROP TABLE "brands"`);
      db.exec(`ALTER TABLE "brands_new" RENAME TO "brands"`);

      const columns = (name: string) => (db.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[]).map((c) => c.name);
      db.exec(framesSql.replace('CREATE TABLE "frames"', 'CREATE TABLE "frames_new"'));
      const old = new Set(columns("frames"));
      const shared = columns("frames_new").filter((c) => old.has(c));
      const select = shared.map((c) => (c === "brand_id" ? `COALESCE((SELECT m."new" FROM "_brand_map" m WHERE m."old" = f."brand_id"), CAST(f."brand_id" AS TEXT))` : `f."${c}"`)).join(", ");
      db.exec(`INSERT INTO "frames_new" (${shared.map((c) => `"${c}"`).join(", ")}) SELECT ${select} FROM "frames" f`);
      db.exec(`DROP TABLE "frames"`);
      db.exec(`ALTER TABLE "frames_new" RENAME TO "frames"`);

      if ((db.prepare(`PRAGMA table_info("pending_deletions")`).all() as unknown[]).length > 0) db.exec(`DELETE FROM "pending_deletions" WHERE "kind" = 'brand'`);
      db.exec(`DROP TABLE "_brand_map"`);
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
  return true;
}

/** The foreign keys a CREATE TABLE statement of init.sql asks for: column -> rule ("CASCADE", "SET NULL", "RESTRICT", ...). */
function foreignKeyRules(createSql: string): Map<string, string> {
  const rules = new Map<string, string>();
  for (const match of createSql.matchAll(/FOREIGN KEY \("(\w+)"\) REFERENCES "\w+" \("\w+"\) ON DELETE ([A-Z ]+?) ON UPDATE/g)) rules.set(match[1], match[2]);
  return rules;
}

/**
 * SQLite cannot change a foreign key in place, so every table whose foreign key rules differ from the ones in init.sql (the schema
 * is the truth) is rebuilt: the new table is created from init.sql, the rows are copied over, the old table is dropped and the new
 * one renamed (the procedure SQLite documents). It is how a database made before a rule changed (a photo row going with its product,
 * a customer's prescriptions going with the customer, their orders keeping the order with the link emptied, ...) is brought up to date.
 * Returns the tables it rebuilt (none on a database that is already right, which is every start but the first after a change).
 */
function rebuildTablesWithChangedForeignKeys(db: Database.Database, initSql: string): string[] {
  const stale: { table: string; create: string }[] = [];
  for (const match of initSql.matchAll(/CREATE TABLE "(\w+)" \([\s\S]*?\n\);/g)) {
    const [create, table] = match;
    const wanted = foreignKeyRules(create);
    if (wanted.size === 0) continue;
    const existing = db.prepare(`PRAGMA foreign_key_list("${table}")`).all() as { from: string; on_delete: string }[];
    if (existing.some((fk) => wanted.has(fk.from) && wanted.get(fk.from) !== fk.on_delete.toUpperCase())) stale.push({ table, create });
  }
  if (stale.length === 0) return [];

  db.pragma("foreign_keys = OFF"); // tables that are dropped and renamed must not trigger the rules of the tables that refer to them
  try {
    db.transaction(() => {
      for (const { table, create } of stale) {
        db.exec(create.replace(`CREATE TABLE "${table}"`, `CREATE TABLE "${table}_new"`)); // constraint names are per table in SQLite, so they stay as they are
        const columns = (name: string) => (db.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[]).map((c) => c.name);
        const old = new Set(columns(table));
        const shared = columns(`${table}_new`).filter((c) => old.has(c)).map((c) => `"${c}"`).join(", ");
        db.exec(`INSERT INTO "${table}_new" (${shared}) SELECT ${shared} FROM "${table}"`);
        db.exec(`DROP TABLE "${table}"`);
        db.exec(`ALTER TABLE "${table}_new" RENAME TO "${table}"`);
      }
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
  return stale.map((t) => t.table);
}

/**
 * The tables whose rows are never deleted: the money trail and its numbering. The server's login has no DELETE on them either; here
 * a trigger refuses it, so nothing (a screen, a script, a mistake) can remove such a row from this computer. Cancel or void them instead.
 */
const NEVER_DELETED = ["orders", "order_items", "payments", "invoices", "invoice_items", "number_sequences"];

/**
 * A prescription that an order uses is a record of what was ordered: its clinical columns cannot be changed. (Only the sync mark and the
 * update time may: they are not in the list.) The service says so first; this is what stops anything that goes around it.
 */
const PRESCRIPTION_RECORD_COLUMNS = [
  "customer_id", "prescribed_at", "prescriber_name", "right_sphere", "right_cylinder", "right_axis", "right_add", "left_sphere", "left_cylinder",
  "left_axis", "left_add", "pd", "pd_right", "pd_left", "fitting_height_right", "fitting_height_left", "notes", "image_url",
];

/** Creates the triggers (a rebuilt table loses its own, so this runs after the rebuild, and on every start: it is idempotent). */
function protectFromDeletes(db: Database.Database): void {
  for (const table of NEVER_DELETED) {
    db.exec(`CREATE TRIGGER IF NOT EXISTS "${table}_never_deleted" BEFORE DELETE ON "${table}" BEGIN SELECT RAISE(ABORT, 'Rows of ${table} are never deleted: cancel or void them instead.'); END;`);
  }
  db.exec(
    `CREATE TRIGGER IF NOT EXISTS "prescriptions_used_not_changed" BEFORE UPDATE OF ${PRESCRIPTION_RECORD_COLUMNS.map((c) => `"${c}"`).join(", ")} ON "prescriptions" ` +
      `WHEN EXISTS (SELECT 1 FROM "orders" WHERE "prescription_id" = OLD."id") BEGIN SELECT RAISE(ABORT, 'A prescription that an order uses cannot be changed: create a new one instead.'); END;`,
  );
}

/**
 * Creates the folder and the db file if they're missing (opening a better-sqlite3 database creates
 * its file), and any table or index in the schema that the db doesn't have yet. Prisma's script
 * uses plain CREATE TABLE/INDEX, so IF NOT EXISTS is added to make running it on every start safe:
 * a new install gets the whole schema, and an existing one picks up tables added since — but
 * columns changed on a table that already exists are NOT touched (new ones go in ADDED_COLUMNS).
 */
function ensureDatabaseExists(dbPath: string): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const initSql = readInitSql();
  const idempotentSql = initSql
    .replace(/^CREATE TABLE /gm, "CREATE TABLE IF NOT EXISTS ")
    .replace(/^CREATE (UNIQUE )?INDEX /gm, "CREATE $1INDEX IF NOT EXISTS ");

  const db = new Database(dbPath);
  try {
    // The columns an older database lacks are added BEFORE the schema script runs: its indexes may be on those very columns (a unique
    // index on frames.code would otherwise fail on a database that has no such column yet). A table that is not there yet is skipped.
    addMissingColumns(db);
    convertBrandIdsToUuids(db, initSql); // a database that numbered its brands (before the schema script, whose indexes are on the new tables)
    db.exec(idempotentSql);
    addMissingColumns(db);
    // A rebuilt table loses its indexes with the old table: creating the missing ones again (it is idempotent) puts them back.
    if (rebuildTablesWithChangedForeignKeys(db, initSql).length > 0) db.exec(idempotentSql);
    protectFromDeletes(db);
  } finally {
    db.close();
  }
}

const dbPath = resolveDbPath();
ensureDatabaseExists(dbPath);

const adapter = new PrismaBetterSqlite3({ url: dbPath });

export const sqlitePrisma = new PrismaClient({ adapter });

/**
 * SQLite has no native array column type, so Frame.images/colors and Accessory.images are
 * stored as JSON-encoded TEXT (see prisma/sqlite/schema.prisma) — these keep call sites from
 * needing to know that.
 */
export function encodeStringArray(values: string[]): string {
  return JSON.stringify(values);
}

export function decodeStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
