import { localDatabase } from "./local";
import type { DatabaseName, LocalDatabase } from "./types";

/**
 * The entry point to the database of this computer:
 *
 *   const frames = await database("local").table("frames").list({ brandId: 3 });
 *
 * The window never reaches the database directly: it talks to the main process, which uses this.
 * (The remote side is not a database connection any more: the sync layer will talk to the server over HTTP.)
 */

export function database(name: DatabaseName): LocalDatabase {
  if (name === "local") return localDatabase;
  throw new Error(`Unknown database "${name}" — use "local".`);
}

export { TABLE_NAMES } from "./types";
export type { Database, DatabaseName, LocalDatabase, TableApi, TableName, TableTypes } from "./types";
