import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { ConfigError } from "../config";
import { currentTenantKey } from "../local/context";
import { LocalDbError } from "../local/errors";
import type { Category } from "../services/types";
import { columnsOf, remoteConnection, RemoteUnreachableError } from "./remote";
import type { TableApi } from "./types";

/**
 * The table API (see types.ts) on the remote database, written once for every table from the
 * column names of the local model. Every call runs in its own transaction for the shop's tenant key.
 */

type Row = Record<string, unknown>;

/** Postgres errors the caller can act on become LocalDbError; anything else is passed through. */
function translate(err: unknown, table: string): unknown {
  if (err instanceof LocalDbError || err instanceof RemoteUnreachableError || err instanceof ConfigError) return err;
  const code = (err as { code?: string }).code ?? "";
  if (code === "23505") return new LocalDbError(`${table}: a row with the same unique value (id or name) already exists.`, "duplicate");
  if ((code === "23503" || code === "23001")) return new LocalDbError(`${table}: it refers to, or is still referred to by, another row.`, "invalid-reference");
  if (code.startsWith("22") || code === "23502" || code === "23514") return new LocalDbError(`${table}: ${(err as Error).message}`, "invalid-input");
  return err;
}

export function remoteTable(table: string): TableApi<any, any> {
  const columns = columnsOf(table);
  const byField = new Map(columns.map((c) => [c.field, c]));
  const selectList = columns.map((c) => `"${c.column}"`).join(", ");
  const serialId = table === "brands"; // the only table whose id the database picks

  /** A database row as the app sees it: camelCase fields, dates as ISO strings. */
  const toApp = (dbRow: Row): Row =>
    Object.fromEntries(columns.map((c) => [c.field, dbRow[c.column] instanceof Date ? (dbRow[c.column] as Date).toISOString() : dbRow[c.column]]));

  async function run<T>(fn: (client: PoolClient, tenantKey: string) => Promise<T>): Promise<T> {
    const tenantKey = await currentTenantKey();
    try {
      return await remoteConnection.transaction(tenantKey, (client) => fn(client, tenantKey));
    } catch (err) {
      throw translate(err, table);
    }
  }

  function checkFields(input: Row): void {
    const unknown = Object.keys(input).filter((key) => key !== "tenantKey" && !byField.has(key));
    if (unknown.length) throw new LocalDbError(`${table}: unknown field(s) ${unknown.join(", ")}.`, "invalid-input");
  }

  async function insertOne(client: PoolClient, tenantKey: string, input: Row): Promise<Row> {
    checkFields(input);
    const values: Row = { ...input, tenantKey };
    if (!serialId && values.id === undefined) values.id = randomUUID();
    for (const c of columns) if (c.isUpdatedAt && values[c.field] === undefined) values[c.field] = new Date();
    const present = columns.filter((c) => values[c.field] !== undefined);
    const result = await client.query(
      `INSERT INTO "${table}" (${present.map((c) => `"${c.column}"`).join(", ")}) VALUES (${present.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING ${selectList}`,
      present.map((c) => values[c.field]),
    );
    return toApp(result.rows[0]);
  }

  return {
    async list(filter: Record<string, string | number | boolean> = {}) {
      const entries = Object.entries(filter);
      for (const [field] of entries) if (!byField.has(field)) throw new LocalDbError(`${table}: cannot filter on unknown field "${field}".`, "invalid-input");
      return run(async (client, tenantKey) => {
        const where = ['"tenant_key" = $1', ...entries.map(([field], i) => `"${byField.get(field)!.column}" = $${i + 2}`)].join(" AND ");
        const result = await client.query(`SELECT ${selectList} FROM "${table}" WHERE ${where} ORDER BY "id"`, [tenantKey, ...entries.map(([, v]) => v)]);
        return result.rows.map(toApp);
      });
    },

    async get(id: string | number) {
      return run(async (client, tenantKey) => {
        const result = await client.query(`SELECT ${selectList} FROM "${table}" WHERE "id" = $1 AND "tenant_key" = $2`, [id, tenantKey]);
        return result.rows[0] ? toApp(result.rows[0]) : null;
      });
    },

    async insert(input: Row) {
      return run((client, tenantKey) => insertOne(client, tenantKey, input));
    },

    async insertMany(inputs: Row[]) {
      return run(async (client, tenantKey) => {
        const out: Row[] = [];
        for (const input of inputs) out.push(await insertOne(client, tenantKey, input));
        return out;
      });
    },

    async update(id: string | number, changes: Row) {
      checkFields(changes);
      return run(async (client, tenantKey) => {
        const set = columns.filter((c) => c.field !== "id" && c.field !== "tenantKey" && changes[c.field] !== undefined);
        const assignments = set.map((c, i) => `"${c.column}" = $${i + 1}`);
        const params: unknown[] = set.map((c) => changes[c.field]);
        for (const c of columns) if (c.isUpdatedAt && !set.includes(c)) { assignments.push(`"${c.column}" = $${params.length + 1}`); params.push(new Date()); }
        if (!assignments.length) {
          const current = await client.query(`SELECT ${selectList} FROM "${table}" WHERE "id" = $1 AND "tenant_key" = $2`, [id, tenantKey]);
          if (!current.rows[0]) throw new LocalDbError(`Update ${table}: no row "${id}".`, "not-found");
          return toApp(current.rows[0]);
        }
        const result = await client.query(
          `UPDATE "${table}" SET ${assignments.join(", ")} WHERE "id" = $${params.length + 1} AND "tenant_key" = $${params.length + 2} RETURNING ${selectList}`,
          [...params, id, tenantKey],
        );
        if (!result.rows[0]) throw new LocalDbError(`Update ${table}: no row "${id}".`, "not-found");
        return toApp(result.rows[0]);
      });
    },

    async remove(id: string | number) {
      await run(async (client, tenantKey) => {
        const result = await client.query(`DELETE FROM "${table}" WHERE "id" = $1 AND "tenant_key" = $2`, [id, tenantKey]);
        if (!result.rowCount) throw new LocalDbError(`Delete ${table}: no row "${id}".`, "not-found");
      });
    },
  };
}

/** Categories are global: no shop, no writes. */
export const remoteCategories = {
  async list(): Promise<Category[]> {
    return remoteConnection.transaction(null, async (client) => {
      const result = await client.query('SELECT id, name, image_url AS "imageUrl" FROM categories ORDER BY id');
      return result.rows as Category[];
    });
  },
};
