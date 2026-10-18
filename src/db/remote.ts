import { Pool, types, defaults, type PoolClient } from "pg";
import { getConfig } from "../config";
import { Prisma } from "../generated/sqlite-client";

// Timestamps are stored without a time zone, as UTC (that is how Prisma and the website write them):
// read them back as UTC and send Dates as UTC, whatever the time zone of this computer.
types.setTypeParser(1114, (value) => new Date(`${value.replace(" ", "T")}Z`));
(defaults as { parseInputDatesAsUTC?: boolean }).parseInputDatesAsUTC = true;

/**
 * The remote database (Neon), reached directly with the `database.url` from config.properties —
 * the low-level half: connection, transactions, column names and the two operations the sync layer
 * needs (upsertMany, saveBrand). The table API on top of it is in remoteTables.ts, and everything
 * is reached through `database("remote")` (see index.ts).
 *
 * Every statement runs in a transaction that first sets `app.tenant_key`, which is what the
 * row-level-security policies compare each row's tenant_key against (they are not applied to a
 * table's owner, but setting it costs nothing and keeps a limited role working).
 */

/** The database could not be reached (offline, DNS, timeout, dropped connection). Expected, not a bug. */
export class RemoteUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteUnreachableError";
  }
}

const UNREACHABLE_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "EPIPE", "ECONNABORTED"]);

export function isUnreachable(err: unknown): boolean {
  const e = err as { code?: string; message?: string; errors?: unknown[] };
  if (e.code && (UNREACHABLE_CODES.has(e.code) || e.code.startsWith("08") || e.code.startsWith("57P0"))) return true;
  // Node can wrap several attempts (IPv4 and IPv6) in one AggregateError.
  if (Array.isArray(e.errors) && e.errors.length && e.errors.every(isUnreachable)) return true;
  return /timeout exceeded when trying to connect|Connection terminated|connection error|Client has encountered|getaddrinfo/i.test(e.message ?? "");
}

// ---- Connection ---------------------------------------------------------------------------------

let pool: Pool | null = null;
let poolUrl = "";

/** One small pool, rebuilt if the URL in config.properties changes (the file is re-read on every call). */
function getPool(): Pool {
  const { databaseUrl } = getConfig();
  if (pool && poolUrl === databaseUrl) return pool;
  void pool?.end().catch(() => undefined);
  pool = new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 15_000, idleTimeoutMillis: 30_000 });
  // The server may drop idle connections; that must never take the app down.
  pool.on("error", () => undefined);
  poolUrl = databaseUrl;
  return pool;
}

/** Runs `fn` in a transaction on one connection; offline failures become RemoteUnreachableError. */
async function transaction<T>(tenantKey: string | null, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient;
  try {
    client = await getPool().connect();
  } catch (err) {
    throw isUnreachable(err) ? new RemoteUnreachableError(`Cannot reach the database (${(err as Error).message}).`) : err;
  }
  let broken = false;
  try {
    await client.query("BEGIN");
    if (tenantKey) await client.query("SELECT set_config('app.tenant_key', $1, true)", [tenantKey]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    broken = isUnreachable(err);
    await client.query("ROLLBACK").catch(() => undefined);
    throw broken ? new RemoteUnreachableError(`Lost the connection to the database (${(err as Error).message}).`) : err;
  } finally {
    client.release(broken);
  }
}

// ---- Columns ------------------------------------------------------------------------------------

/** Columns that exist only in the local database. */
const LOCAL_ONLY = new Set(["synced", "remoteId"]);

export interface Column {
  field: string;
  column: string;
  isUpdatedAt: boolean;
}

/** table -> its columns, read from the local model (the two schemas use the same names). */
export function columnsOf(table: string): Column[] {
  const model = Prisma.dmmf.datamodel.models.find((m) => (m.dbName ?? m.name) === table);
  if (!model) throw new Error(`Unknown table "${table}".`);
  return model.fields
    .filter((f) => f.kind === "scalar" && !LOCAL_ONLY.has(f.name))
    .map((f) => ({ field: f.name, column: f.dbName ?? f.name, isUpdatedAt: Boolean(f.isUpdatedAt) || f.name === "updatedAt" }));
}

// ---- Operations ---------------------------------------------------------------------------------

export const remoteConnection = {
  transaction,

  /** Resolves when the database answers; rejects with RemoteUnreachableError when it doesn't. */
  async ping(): Promise<void> {
    try {
      await getPool().query("SELECT 1");
    } catch (err) {
      throw isUnreachable(err) ? new RemoteUnreachableError(`Cannot reach the database (${(err as Error).message}).`) : err;
    }
  },

  /** The shops this database holds (the `tenants` table has no row-level security). */
  async fetchTenants(): Promise<{ key: string; host: string; name: string }[]> {
    return transaction(null, async (client) => {
      // The database user is tied to one shop by a row-level-security policy on every table
      // (`tenant_key = '<key>'`), and any user may read the policy text. That works even when the user
      // may not read the `tenants` table, and also before the shop has any rows.
      // Policies that name this login come first (that is the shop it was made for); policies open to
      // every login only count when there are none, because an old shop's open policy must not make
      // a newer shop's login look like it belongs to two shops.
      const policies = await client.query(
        `SELECT DISTINCT qual, (current_user = ANY(roles)) AS mine
           FROM pg_policies
          WHERE schemaname = 'public' AND qual ~ 'tenant_key = ''[^'']+'''
            AND (current_user = ANY(roles) OR roles = '{public}')`,
      );
      const mine = policies.rows.some((r) => r.mine);
      const keys = new Set<string>();
      for (const { qual, mine: isMine } of policies.rows) {
        if (mine && !isMine) continue;
        const m = /tenant_key = '([^']+)'/.exec(qual);
        if (m) keys.add(m[1]);
      }
      if (keys.size > 0) return [...keys].sort().map((key) => ({ key, host: "", name: key }));
      return (await client.query("SELECT key, host, name FROM tenants ORDER BY key")).rows;
    });
  },

  /**
   * Inserts the rows, or updates the ones whose id already exists, all in one transaction (all or
   * nothing). Rows use the field names of the local model (camelCase); array values must already be
   * real arrays. The tenant is forced to `tenantKey`.
   */
  async upsertMany(tenantKey: string, table: string, rows: Record<string, unknown>[]): Promise<void> {
    const columns = columnsOf(table);
    const known = new Set(columns.map((c) => c.field));
    await transaction(tenantKey, async (client) => {
      for (const row of rows) {
        const unknown = Object.keys(row).filter((key) => !known.has(key));
        if (unknown.length) throw new Error(`${table}: unknown field(s) ${unknown.join(", ")}.`);
        const values: Record<string, unknown> = { ...row, tenantKey };
        for (const c of columns) if (c.isUpdatedAt && values[c.field] === undefined) values[c.field] = new Date();

        const present = columns.filter((c) => values[c.field] !== undefined);
        const names = present.map((c) => `"${c.column}"`).join(", ");
        const placeholders = present.map((_, i) => `$${i + 1}`).join(", ");
        // On a conflict everything is overwritten except the id and the original creation time.
        const updates = present.filter((c) => c.field !== "id" && c.field !== "createdAt").map((c) => `"${c.column}" = EXCLUDED."${c.column}"`).join(", ");
        await client.query(
          `INSERT INTO "${table}" (${names}) VALUES (${placeholders}) ON CONFLICT ("id") DO UPDATE SET ${updates}`,
          present.map((c) => values[c.field]),
        );
      }
    });
  },

  /**
   * Brands have a serial id that the database picks. Without an `id` a new brand is inserted and its
   * id returned; with one, that brand is renamed. A name already used by another brand of the shop
   * is refused by the database (unique violation).
   */
  async saveBrand(tenantKey: string, brand: { id?: number; name: string }): Promise<{ id: number }> {
    return transaction(tenantKey, async (client) => {
      if (brand.id !== undefined) {
        const updated = await client.query("UPDATE brands SET name = $1 WHERE id = $2 AND tenant_key = $3 RETURNING id", [brand.name, brand.id, tenantKey]);
        if (!updated.rowCount) throw new Error(`brands: no brand ${brand.id} of this shop to rename.`);
        return { id: updated.rows[0].id as number };
      }
      const inserted = await client.query("INSERT INTO brands (name, tenant_key) VALUES ($1, $2) RETURNING id", [brand.name, tenantKey]);
      return { id: inserted.rows[0].id as number };
    });
  },

  /** Closes the connections (the app is quitting). */
  async close(): Promise<void> {
    const old = pool;
    pool = null;
    poolUrl = "";
    await old?.end().catch(() => undefined);
  },
};
