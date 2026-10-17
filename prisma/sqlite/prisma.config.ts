// Only used by Prisma CLI commands (db push, migrate, studio) against the SQLite schema — pass
// --config prisma/sqlite/prisma.config.ts. The app's own client (src/lib/sqliteClient.ts) reads
// SQLITE_DATABASE_URL itself via the driver adapter and never touches this file.
//
// A relative datasource.url resolves relative to THIS file's own directory, not the project
// root or the process's cwd — so the default below is computed as an absolute path instead, via
// __dirname, to guarantee it points at the exact same file sqliteClient.ts defaults to.
import "dotenv/config";
import path from "node:path";
import { defineConfig } from "prisma/config";


const defaultDbPath = path.join(__dirname, "..", "..", "local.db");

export default defineConfig({
  schema: "schema.prisma",
  migrations: {
    path: "migrations",
  },
  datasource: {
    url: process.env["SQLITE_DATABASE_URL"] ?? `file:${defaultDbPath}`,
  },
});
