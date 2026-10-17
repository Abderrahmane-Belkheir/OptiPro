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
  { table: "brands", column: "remote_id", definition: "INTEGER" },
  { table: "frames", column: "eye_size", definition: "INTEGER" },
  { table: "frames", column: "bridge", definition: "INTEGER" },
  { table: "frames", column: "temple_length", definition: "INTEGER" },
  { table: "frames", column: "reference", definition: "TEXT" },
  { table: "frames", column: "cost_price", definition: "REAL" },
  { table: "accessories", column: "cost_price", definition: "REAL" },
  { table: "customers", column: "date_of_birth", definition: "DATETIME" },
  { table: "lenses", column: "polarized", definition: "BOOLEAN NOT NULL DEFAULT false" },
  { table: "lenses", column: "tint", definition: "TEXT" },
  { table: "prescriptions", column: "pd_right", definition: "REAL" },
  { table: "prescriptions", column: "pd_left", definition: "REAL" },
  { table: "prescriptions", column: "fitting_height_right", definition: "REAL" },
  { table: "prescriptions", column: "fitting_height_left", definition: "REAL" },
];

function addMissingColumns(db: Database.Database): void {
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const existing = db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[];
    if (!existing.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`);
    }
  }
  // Brands synced before remote_id existed had their local id swapped for the backend's, so the two are equal.
  db.exec(`UPDATE "brands" SET "remote_id" = "id" WHERE "synced" = 1 AND "remote_id" IS NULL`);
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

  const idempotentSql = readInitSql()
    .replace(/^CREATE TABLE /gm, "CREATE TABLE IF NOT EXISTS ")
    .replace(/^CREATE (UNIQUE )?INDEX /gm, "CREATE $1INDEX IF NOT EXISTS ");

  const db = new Database(dbPath);
  try {
    db.exec(idempotentSql);
    addMissingColumns(db);
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
