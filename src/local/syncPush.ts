import { currentTenantKey } from "./context";
import { LocalDbError } from "./errors";
import { db } from "./rawDb";
import { SYNC_PARENTS } from "./syncParents";

/**
 * Two ways to push rows that are not synced yet — "not synced" meaning `synced = 0`:
 *
 *   pushRow(table, id)      one row
 *   pushTable(table)        every row of the table that is ready
 *
 * Both use the same rule, written once as a SQL filter (see readyFilter): the row has `synced = 0`
 * AND every parent it points at is synced. One unsynced parent holds the row back; an optional
 * parent left empty doesn't count. Rows that fail the filter are not sent and not touched, so they
 * can be tried again later, e.g. once their parent has been pushed.
 *
 * Every insert and update calls pushRow right after saving. When the remote database accepts the row, the
 * row's `synced` flag is set to 1 in that same step (inside the table's pusher), so a row is never
 * "sent but still marked unsynced" or the other way round.
 *
 * Neither function throws because the remote database is unreachable — they report it in their result —
 * and both honour `syncFlag.push = false`. To release a whole chain of dependent rows, call
 * pushTable for each table parents first (SYNC_ORDER).
 *
 * This file imports no service: each table's service registers its own pusher when it loads
 * (registerPusher), which is what lets the services call pushRow without an import cycle.
 */

type Id = string | number;
/** Sends these rows of one table to the remote database and marks the accepted ones synced. */
export type Pusher = (ids: Id[], tenantKey: string) => Promise<unknown>;

/** Every synced table, parents first, with its Prisma delegate. */
const TABLES = {
  brands: "brand",
  customers: "customer",
  lenses: "lens",
  suppliers: "supplier",
  frames: "frame",
  accessories: "accessory",
  prescriptions: "prescription",
  orders: "order",
  supplier_orders: "supplierOrder",
  supplier_order_items: "supplierOrderItem",
  order_items: "orderItem",
  payments: "payment",
  invoices: "invoice",
  invoice_items: "invoiceItem",
  number_sequences: "numberSequence",
} as const;

export type SyncTable = keyof typeof TABLES;

/** Parents first: pushing the tables in this order releases every dependent row in one pass. */
export const SYNC_ORDER = Object.keys(TABLES) as SyncTable[];

const pushers: Partial<Record<SyncTable, Pusher>> = {};

/** Called once by each table's service when it loads. */
export function registerPusher(table: SyncTable, pusher: Pusher): void {
  pushers[table] = pusher;
}

function pusherFor(table: SyncTable): Pusher {
  const pusher = pushers[table];
  if (!pusher) throw new Error(`No pusher is registered for "${table}". Import the local services (from "./local") before pushing.`);
  return pusher;
}

/** The most rows sent in one request (the remote database accepts up to 500, all or nothing). */
const DEFAULT_BATCH_SIZE = 500;

/**
 * The SQL condition "every parent is synced", as a Prisma filter that becomes a join in the query.
 * A required parent must be synced; an optional one must be empty or synced.
 */
function readyFilter(table: SyncTable): object[] {
  return (SYNC_PARENTS[table] ?? []).map(({ field, optional }) => {
    const relation = field.replace(/Id$/, ""); // customerId -> customer (checked by check-sync-parents)
    const parentSynced = { synced: true };
    return optional ? { OR: [{ [field]: null }, { [relation]: parentSynced }] } : { [relation]: parentSynced };
  });
}

function assertTable(table: string): asserts table is SyncTable {
  if (!(table in TABLES)) throw new LocalDbError(`Unknown table "${table}". Tables: ${SYNC_ORDER.join(", ")}.`, "invalid-input");
}

/** How many rows each table has with synced = 0 (local queries only, no network). */
export async function countPending(): Promise<Record<SyncTable, number>> {
  const tenantKey = await currentTenantKey();
  const counts = await Promise.all(SYNC_ORDER.map((table) => db[TABLES[table]].count({ where: { tenantKey, synced: false } })));
  return Object.fromEntries(SYNC_ORDER.map((table, index) => [table, counts[index]])) as Record<SyncTable, number>;
}

// ---- one row --------------------------------------------------------------------------------

/**
 * How long a caller that a person is waiting on (the screen after "Save") waits for ONE push before it moves on. The push is not stopped: it goes on in the background and
 * marks the row synced when the server has it. So a slow server, a bad connection or a big batch never keeps the person waiting more than this; the answer is then
 * "push-pending". OPTIPRO_PUSH_WAIT_MS changes it (the tests make it long, so a slow test machine does not change what they see).
 */
export function interactiveWaitMs(): number {
  const fromEnv = Number(process.env.OPTIPRO_PUSH_WAIT_MS);
  return Number.isFinite(fromEnv) && process.env.OPTIPRO_PUSH_WAIT_MS !== undefined && process.env.OPTIPRO_PUSH_WAIT_MS !== "" && fromEnv >= 0 ? fromEnv : 1500;
}

export interface PushRowResult {
  /** True when the row is synced now (including when it already was). */
  synced: boolean;
  /**
   * Why it isn't, or what happened:
   *  not-found           no such row for this tenant
   *  already-synced      nothing to do
   *  parents-not-synced  a parent is not synced yet; nothing was sent
   *  push-failed         the remote database did not accept it (offline, refused, or syncFlag.push is off); it stays unsynced
   *  push-pending        the server has not answered yet (see interactiveWaitMs): the push goes on in the background, `done` is its final result
   */
  reason?: "not-found" | "already-synced" | "parents-not-synced" | "push-failed" | "push-pending";
  /** With "push-pending": the push still on its way; it settles with the final result and never rejects. */
  done?: Promise<PushRowResult>;
}

/** Every push of a row goes through this one line, in the order it was asked for: a child asked for after its parent is tried after the parent has landed. */
let pushLine: Promise<unknown> = Promise.resolve();
/** After a push that took longer than the wait, until when callers do not wait at all (the server is slow): they just queue and move on. */
let slowUntil = 0;
const SLOW_MODE_MS = 30_000;
const MIN_WAIT_MS = 25;

/**
 * Pushes one row, if it is unsynced and all its parents are synced; sets `synced` to 1 once the remote database has it. The caller waits for the answer for at most
 * interactiveWaitMs(): if the server is slower, the answer is { synced: false, reason: "push-pending", done } and the push carries on in the background.
 */
export async function pushRow(table: SyncTable, id: Id): Promise<PushRowResult> {
  assertTable(table);
  const wait = Date.now() < slowUntil ? MIN_WAIT_MS : Math.max(interactiveWaitMs(), MIN_WAIT_MS);
  const started = Date.now();
  const job = pushLine.then(() => pushRowNow(table, id));
  pushLine = job.then(() => undefined, () => undefined);
  void job.then(() => { if (Date.now() - started < Math.max(interactiveWaitMs(), MIN_WAIT_MS)) slowUntil = 0; }, () => undefined);
  const pending = Symbol("pending");
  let timer: NodeJS.Timeout | undefined;
  const outcome = await Promise.race([job, new Promise<typeof pending>((resolve) => { timer = setTimeout(() => resolve(pending), wait); })]).finally(() => clearTimeout(timer));
  if (outcome !== pending) return outcome as PushRowResult;
  slowUntil = Date.now() + SLOW_MODE_MS;
  const done = job.catch((): PushRowResult => ({ synced: false, reason: "push-failed" }));
  return { synced: false, reason: "push-pending", done };
}

async function pushRowNow(table: SyncTable, id: Id): Promise<PushRowResult> {
  const tenantKey = await currentTenantKey();
  const delegate = TABLES[table];

  const row = await db[delegate].findFirst({ where: { id, tenantKey }, select: { id: true, synced: true } });
  if (!row) return { synced: false, reason: "not-found" };
  if (row.synced) return { synced: true, reason: "already-synced" };

  const ready = await db[delegate].findFirst({ where: { id, tenantKey, synced: false, AND: readyFilter(table) }, select: { id: true } });
  if (!ready) return { synced: false, reason: "parents-not-synced" };

  await pusherFor(table)([id], tenantKey);
  const after = await db[delegate].findFirst({ where: { id, tenantKey }, select: { synced: true } });
  return after?.synced ? { synced: true } : { synced: false, reason: "push-failed" };
}

// ---- a whole table --------------------------------------------------------------------------

export interface PushTableResult {
  table: SyncTable;
  /** Rows with synced = 0. */
  pending: number;
  /** Of those, the ones whose parents are all synced: the ones that were sent. */
  eligible: number;
  /** Of those, the ones the remote database accepted (0 when it is unreachable). */
  sent: number;
  /** pending - eligible: rows still waiting for a parent. */
  held: number;
}

/**
 * Pushes every row of `table` that has synced = 0 and whose parents are all synced, filtered in SQL
 * rather than row by row, in requests of at most `batchSize` rows (each request is all-or-nothing).
 * Rows waiting for a parent are left alone and counted in `held`.
 */
export async function pushTable(table: SyncTable, options: { batchSize?: number } = {}): Promise<PushTableResult> {
  assertTable(table);
  const tenantKey = await currentTenantKey();
  const delegate = TABLES[table];
  const push = pusherFor(table);
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);

  const pending = await db[delegate].count({ where: { tenantKey, synced: false } });
  const ready = await db[delegate].findMany({ where: { tenantKey, synced: false, AND: readyFilter(table) }, select: { id: true }, orderBy: { id: "asc" } });
  const ids = ready.map((row) => row.id as Id);

  let sent = 0;
  for (let start = 0; start < ids.length; start += batchSize) {
    const batch = ids.slice(start, start + batchSize);
    await push(batch, tenantKey);
    sent += await db[delegate].count({ where: { id: { in: batch }, tenantKey, synced: true } });
  }

  return { table, pending, eligible: ids.length, sent, held: pending - ids.length };
}
