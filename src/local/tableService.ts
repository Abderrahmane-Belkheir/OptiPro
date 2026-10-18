import { randomUUID } from "node:crypto";
import { sqlitePrisma } from "../lib/sqliteClient";
import { currentTenantKey } from "./context";
import { remoteConnection } from "../db/remote";
import { LocalDbError, translateError } from "./errors";
import { db } from "./rawDb";
import { tryPush } from "./sync";
import { pushRow, registerPusher, type SyncTable } from "./syncPush";

/**
 * The local read/write/sync logic shared by the shop-management tables (prescriptions, lenses,
 * orders, order lines, payments, invoices, invoice lines, number sequences). Every one of them:
 *   - is scoped to the tenant key from config.properties;
 *   - has a client-generated UUID id, the same on the remote database, so no id mapping is needed;
 *   - starts `synced = false`, goes back to false on every update, and is pushed to the remote database
 *     right after it is saved (best effort — see sync.ts);
 *   - is only pushed once every row it refers to ("parents") is itself synced, because the remote database
 *     refuses a row pointing at something it doesn't have.
 */

export interface TableConfig {
  /** The table, as syncPush.ts knows it: "order_items". */
  table: SyncTable;
  /** For messages: "prescription". */
  label: string;
  /** The Prisma delegate name: "prescription". */
  delegate: string;
  /** Columns holding dates; callers pass ISO strings, the database stores dates. */
  dateFields?: string[];
  /** Foreign keys into other synced tables: the row can only be pushed once the parent is. */
  parents?: { field: string; delegate: string; label: string }[];
  orderBy: Record<string, "asc" | "desc">;
}

type Row = Record<string, unknown>;

/** Dates come out as ISO strings, like everything that crosses the app's boundary. */
function toApp(row: Row): Row {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]));
}

export function createLocalTableService<Out extends { id: string }, In extends object>(config: TableConfig) {
  const table = db[config.delegate];
  const dateFields = config.dateFields ?? [];
  const parents = config.parents ?? [];

  /** ISO strings in, Date objects for the database; null and undefined pass through. */
  function toDatabase(input: Row): Row {
    const out: Row = { ...input };
    for (const field of dateFields) {
      const value = out[field];
      if (typeof value === "string") {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) throw new LocalDbError(`${config.label}: ${field} is not a valid date ("${value}").`, "invalid-reference");
        out[field] = date;
      }
    }
    return out;
  }

  /** Every parent the row names must be one of this tenant's own rows. */
  async function assertParents(values: Row, tenantKey: string): Promise<void> {
    for (const { field, delegate, label } of parents) {
      const id = values[field];
      if (id === undefined || id === null) continue;
      const found = await db[delegate].findFirst({ where: { id, tenantKey }, select: { id: true } });
      if (!found) throw new LocalDbError(`${config.label}: ${field} is not one of your ${label}s.`, "invalid-reference");
    }
  }

  /** What the remote database is sent: the row without the local-only and server-managed columns. */
  function toRemote(row: Row): Row {
    const { tenantKey: _tenant, synced: _synced, updatedAt: _updated, ...rest } = toApp(row);
    return rest;
  }

  /**
   * Sends the rows with these ids to the remote database in one request and marks them synced if it
   * accepted them. A row is held back (stays unsynced, nothing is sent for it) while any parent it
   * refers to is not synced yet. Returns the rows as they now stand.
   */
  async function pushRows(ids: string[], tenantKey: string): Promise<Out[]> {
    const rows = await table.findMany({ where: { id: { in: ids }, tenantKey } });

    // For each parent column, the ids that are already synced.
    const syncedParents = new Map<string, Set<unknown>>();
    for (const { field, delegate } of parents) {
      const wanted = [...new Set(rows.map((row) => row[field]).filter((value) => value !== null && value !== undefined))];
      const found = wanted.length ? await db[delegate].findMany({ where: { id: { in: wanted }, tenantKey, synced: true }, select: { id: true } }) : [];
      syncedParents.set(field, new Set(found.map((parent) => parent.id)));
    }
    const sendable = rows.filter((row) => parents.every(({ field }) => row[field] === null || row[field] === undefined || syncedParents.get(field)!.has(row[field])));

    if (sendable.length) {
      await tryPush(`${sendable.length} ${config.label}(s)`, async () => {
        await remoteConnection.upsertMany(tenantKey, config.table, sendable.map(toRemote));
        await table.updateMany({ where: { id: { in: sendable.map((row) => row.id) }, tenantKey }, data: { synced: true } });
      });
    }

    const fresh = await table.findMany({ where: { id: { in: ids }, tenantKey } });
    return ids.map((id) => toApp(fresh.find((row) => row.id === id)!) as unknown as Out);
  }

  /** Saves the rows (all or none) without pushing them and returns their ids. */
  async function saveMany(inputs: In[]): Promise<string[]> {
    const tenantKey = await currentTenantKey();
    const rows = inputs.map((input) => ({ ...(input as Row) }));
    const ids = rows.map((row) => (typeof row.id === "string" ? row.id : randomUUID()));
    try {
      for (const row of rows) await assertParents(row, tenantKey);
      await sqlitePrisma.$transaction(
        rows.map((row, index) => table.create({ data: { ...toDatabase(row), id: ids[index], tenantKey } }) as never),
      );
    } catch (err) {
      translateError(err, `Insert ${config.label}`);
    }
    return ids;
  }

  const service = {
    /** Optionally narrowed to rows whose columns equal `filter`, e.g. { orderId }. */
    async list(filter: Partial<Record<string, string | number | boolean>> = {}): Promise<Out[]> {
      const tenantKey = await currentTenantKey();
      const rows = await table.findMany({ where: { tenantKey, ...filter }, orderBy: config.orderBy });
      return rows.map((row) => toApp(row) as unknown as Out);
    },

    async get(id: string): Promise<Out | null> {
      const tenantKey = await currentTenantKey();
      const row = await table.findFirst({ where: { id, tenantKey } });
      return row ? (toApp(row) as unknown as Out) : null;
    },

    /**
     * Saves the row (a UUID is generated when `id` is left out), then calls pushRow for it. If the
     * remote database accepted it, the row comes back with `synced: true`.
     */
    async insert(input: In): Promise<Out> {
      const [id] = await saveMany([input]);
      await pushRow(config.table, id);
      return (await service.get(id))!;
    },

    /** Saves all the rows or none of them, then pushes them together in one request (pushRows). */
    async insertMany(inputs: In[]): Promise<Out[]> {
      const ids = await saveMany(inputs);
      return pushRows(ids, await currentTenantKey());
    },

    /** Changes only the fields given, marks the row unsynced, then calls pushRow; the row comes back `synced: true` if the remote database accepted it. */
    async update(id: string, changes: Partial<Omit<In, "id">>): Promise<Out> {
      const tenantKey = await currentTenantKey();
      try {
        await assertParents(changes as Row, tenantKey);
        const { count } = await table.updateMany({ where: { id, tenantKey }, data: { ...toDatabase(changes as Row), synced: false } });
        if (!count) throw new LocalDbError(`Update ${config.label}: no ${config.label} "${id}".`, "not-found");
      } catch (err) {
        translateError(err, `Update ${config.label}`);
      }
      await pushRow(config.table, id);
      return (await service.get(id))!;
    },

    /** Local only: deletes are not sent to the remote database. */
    async remove(id: string): Promise<void> {
      const tenantKey = await currentTenantKey();
      try {
        const { count } = await table.deleteMany({ where: { id, tenantKey } });
        if (!count) throw new LocalDbError(`Delete ${config.label}: no ${config.label} "${id}".`, "not-found");
      } catch (err) {
        translateError(err, `Delete ${config.label}`);
      }
    },

  };
  registerPusher(config.table, (ids, tenantKey) => pushRows(ids as string[], tenantKey));
  return service;
}
