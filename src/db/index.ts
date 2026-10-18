import { localDatabase } from "./local";
import { remoteConnection } from "./remote";
import { remoteCategories, remoteTable } from "./remoteTables";
import type { DatabaseName, LocalDatabase, RemoteDatabase, TableApi, TableName, TableTypes } from "./types";

/**
 * One entry point to both databases. Say which one you mean and use it the same way:
 *
 *   const frames = await database("local").table("frames").list({ brandId: 3 });
 *   const shops  = await database("remote").fetchTenants();
 *   await database("remote").table("orders").insert({ number: "CMD-2026-0001" });
 *
 * Every table has the same API on both (see types.ts); the remote one adds what the sync layer
 * needs (ping, upsertMany, saveBrand). The window never gets the remote one: it only ever talks to
 * the local database, and the sync layer moves the data across.
 */

const remoteTables = new Map<string, TableApi<any, any>>();

export const remoteDatabase: RemoteDatabase = {
  name: "remote",
  table<K extends TableName>(name: K): TableApi<TableTypes[K]["row"], TableTypes[K]["input"]> {
    if (!remoteTables.has(name)) remoteTables.set(name, remoteTable(name));
    return remoteTables.get(name)!;
  },
  categories: remoteCategories,
  ping: remoteConnection.ping,
  fetchTenants: remoteConnection.fetchTenants,
  upsertMany: remoteConnection.upsertMany,
  saveBrand: remoteConnection.saveBrand,
  close: remoteConnection.close,
};

export function database(name: "local"): LocalDatabase;
export function database(name: "remote"): RemoteDatabase;
export function database(name: DatabaseName): LocalDatabase | RemoteDatabase;
export function database(name: DatabaseName): LocalDatabase | RemoteDatabase {
  if (name === "local") return localDatabase;
  if (name === "remote") return remoteDatabase;
  throw new Error(`Unknown database "${name}" — use "local" or "remote".`);
}

export { RemoteUnreachableError } from "./remote";
export { TABLE_NAMES } from "./types";
export type { Database, DatabaseName, LocalDatabase, RemoteDatabase, TableApi, TableName, TableTypes } from "./types";
