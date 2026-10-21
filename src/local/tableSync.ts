import type { Prisma } from "../generated/sqlite-client";
import { decodeStringArray, sqlitePrisma } from "../lib/sqliteClient";
import { RemoteUnreachableError } from "./errors";
import { callTable } from "./tableApiClient";

/**
 * What the table pushers share: turning a local row into the body the table API takes, and sending rows in requests that fit.
 */

/** Local-only columns, and the one the server fills (updated_at): never sent. */
const NOT_SENT = new Set(["tenantKey", "synced", "updatedAt"]);

/** A local row as the table API takes it: field names as they are, dates as ISO strings, lists of texts as real lists. */
export function toApiRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (NOT_SENT.has(key)) continue;
    // A product without a code does not mention one: a server that does not have the column yet still takes the product. (A code is never
    // cleared once given, so leaving it out loses nothing.)
    if (key === "code" && value === null) continue;
    if (value instanceof Date) out[key] = value.toISOString();
    else if ((key === "images" || key === "colors") && typeof value === "string") out[key] = decodeStringArray(value);
    else out[key] = value;
  }
  return out;
}

/** The most rows in one request (the server accepts 500), and the most bytes (it reads 1 MB): a batch is cut into requests that fit. */
export const MAX_ROWS_PER_REQUEST = 200;
const MAX_BYTES_PER_REQUEST = 800_000;

export interface PushItem {
  /** The local id of the row, to tell which ones the server accepted. */
  id: string | number;
  row: Record<string, unknown>;
}

export interface PushOutcome {
  /** The ids the server has now. */
  accepted: Set<string | number>;
  /** Rows the server refused for their own sake (the reason of each), which stay unsynced. */
  problems: string[];
  /** Set when sending was given up because the same cause would hit every request. */
  stoppedBecause?: string;
  /** True when that cause was that the server could not be reached (expected, not worth a warning). */
  unreachable: boolean;
}

/** Cuts the items into requests of at most MAX_ROWS_PER_REQUEST rows and MAX_BYTES_PER_REQUEST bytes. */
function chunks(items: PushItem[]): PushItem[][] {
  const out: PushItem[][] = [];
  let current: PushItem[] = [];
  let bytes = 0;
  for (const item of items) {
    const size = JSON.stringify(item.row).length + 1;
    if (current.length > 0 && (current.length >= MAX_ROWS_PER_REQUEST || bytes + size > MAX_BYTES_PER_REQUEST)) {
      out.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += size;
  }
  if (current.length) out.push(current);
  return out;
}

/**
 * Sends rows with `insert` (insert, or overwrite the row with the same id), a request after another. A request the server
 * refuses for its rows' sake (one bad row refuses the whole request) is sent again one row at a time, so the good rows still get
 * through and only the bad one stays behind. Never throws.
 */
export async function pushInsertRows(table: string, items: PushItem[]): Promise<PushOutcome> {
  const outcome: PushOutcome = { accepted: new Set(), problems: [], unreachable: false };

  /** Returns false when the whole send must stop. */
  async function send(batch: PushItem[]): Promise<boolean> {
    const result = await callTable(table, "insert", { rows: batch.map((item) => item.row) });
    if (result.ok) {
      for (const item of batch) outcome.accepted.add(item.id);
      return true;
    }
    if (result.stopAll) {
      outcome.stoppedBecause = result.reason;
      outcome.unreachable = result.unreachable;
      return false;
    }
    if (batch.length > 1) {
      for (const item of batch) if (!(await send([item]))) return false;
      return true;
    }
    outcome.problems.push(`${table} ${batch[0].id}: ${result.reason}`);
    return true;
  }

  for (const batch of chunks(items)) if (!(await send(batch))) break;
  return outcome;
}

/** Throws what is worth a warning, in the way tryPush understands: nothing for "could not reach the server", the reasons otherwise. */
export function reportPushOutcome(outcome: PushOutcome): void {
  if (outcome.stoppedBecause) {
    if (outcome.unreachable) throw new RemoteUnreachableError(outcome.stoppedBecause);
    throw new Error(outcome.stoppedBecause);
  }
  if (outcome.problems.length) throw new Error(outcome.problems.slice(0, 3).join(" | ") + (outcome.problems.length > 3 ? ` (and ${outcome.problems.length - 3} more)` : ""));
}

type AnyDelegate = { findMany(args: unknown): Promise<Record<string, unknown>[]>; updateMany(args: unknown): Promise<unknown> };

/** A row's content for comparison: every column but the sync mark (and a joined brand). */
const content = (row: Record<string, unknown>) => JSON.stringify(Object.entries(row).filter(([key]) => key !== "synced" && key !== "brand").sort(([a], [b]) => (a < b ? -1 : 1)));

/**
 * Marks as synced the rows the server accepted, EXCEPT the ones that were changed here while the request was on its way: such a row
 * holds newer data than what the server just took, so it stays unsynced and the next pass sends it. (Marking it synced would lose the
 * change for good.) The check and the marking are one transaction, so a change cannot slip in between them.
 * `sent` are the rows as they were read before sending; `delegateOf` picks the table of the transaction's client.
 */
export async function markSyncedIfUnchanged(
  delegateOf: (tx: Prisma.TransactionClient) => unknown,
  tenantKey: string,
  sent: Map<string | number, Record<string, unknown>>,
  accepted: Set<string | number>,
): Promise<void> {
  if (accepted.size === 0) return;
  await sqlitePrisma.$transaction(async (tx) => {
    const delegate = delegateOf(tx) as AnyDelegate;
    const now = await delegate.findMany({ where: { id: { in: [...accepted] }, tenantKey } });
    const unchanged = now.filter((row) => sent.has(row.id as string | number) && content(row) === content(sent.get(row.id as string | number)!)).map((row) => row.id);
    if (unchanged.length) await delegate.updateMany({ where: { id: { in: unchanged }, tenantKey }, data: { synced: true } });
  });
}
