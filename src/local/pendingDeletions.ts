import { sqlitePrisma } from "../lib/sqliteClient";
import { deleteOnServer, type DeletionKind, type ServerDeleteOutcome } from "./serverDelete";
import { syncFlag } from "./sync";

/**
 * The outbox of deletions. Deleting a frame, an accessory or a photo removes it from this computer at once; telling the
 * server is a separate step that needs a connection. The step is written down here first (queueDeletion), tried right
 * away (attemptDeletion), and, if it did not go through, tried again by the 10-minute sync (pushPendingDeletions).
 * An entry leaves the table only when the server no longer has the thing.
 */

/** The most deletions one sync pass sends; the rest wait for the next pass. */
export const MAX_DELETIONS_PER_PASS = 50;

/** Writes a deletion to the outbox. `client` is a transaction's client when the entry must be saved together with the deletion itself. */
export async function queueDeletionIn(client: Pick<typeof sqlitePrisma, "pendingDeletion">, kind: DeletionKind, targetId: string): Promise<void> {
  await client.pendingDeletion.upsert({ where: { kind_targetId: { kind, targetId } }, create: { kind, targetId }, update: {} });
}

export async function queueDeletion(kind: DeletionKind, targetId: string): Promise<void> {
  await queueDeletionIn(sqlitePrisma, kind, targetId);
}

/** Asks the server to delete one queued thing; removes the entry when it is gone, otherwise records why not. */
async function run(entry: { id: number; kind: string; targetId: string }): Promise<ServerDeleteOutcome> {
  const outcome = await deleteOnServer(entry.kind as DeletionKind, entry.targetId);
  if (outcome.ok) {
    await sqlitePrisma.pendingDeletion.deleteMany({ where: { id: entry.id } });
    if (outcome.warning) console.warn(`[sync] ${entry.kind} ${entry.targetId} deleted on the server, but: ${outcome.warning}`);
  } else {
    await sqlitePrisma.pendingDeletion.update({ where: { id: entry.id }, data: { attempts: { increment: 1 }, lastError: outcome.reason.slice(0, 500) } }).catch(() => undefined);
  }
  return outcome;
}

/** Tries one queued deletion now. Resolves to the outcome, or null when nothing is queued for it. Does nothing while `syncFlag.push` is false. */
export async function attemptDeletion(kind: DeletionKind, targetId: string): Promise<ServerDeleteOutcome | null> {
  const entry = await sqlitePrisma.pendingDeletion.findUnique({ where: { kind_targetId: { kind, targetId } } });
  if (!entry) return null;
  if (!syncFlag.push) return { ok: false, reason: "sending to the server is turned off", stopAll: true };
  return run(entry);
}

export async function countPendingDeletions(): Promise<number> {
  return sqlitePrisma.pendingDeletion.count();
}

export interface DeletionPushResult {
  /** Deletions the server has taken (or had already done). */
  sent: number;
  /** Deletions that could not be sent. */
  failed: number;
  /** Deletions still waiting after this pass. */
  remaining: number;
  /** Set when the pass stopped early because the same problem would hit every deletion. */
  stoppedBecause?: string;
  errors: string[];
}

/**
 * Sends the queued deletions, oldest first, at most MAX_DELETIONS_PER_PASS, one after another. One that fails for its
 * own reason does not stop the rest; a failure that would hit all of them (no connection, a refused key, a missing
 * setting, a failing server) stops the pass after that one request. Never throws.
 */
export async function pushPendingDeletions(): Promise<DeletionPushResult> {
  const result: DeletionPushResult = { sent: 0, failed: 0, remaining: 0, errors: [] };
  if (!syncFlag.push) return result;
  try {
    const waiting = await sqlitePrisma.pendingDeletion.count();
    const batch = await sqlitePrisma.pendingDeletion.findMany({ orderBy: { id: "asc" }, take: MAX_DELETIONS_PER_PASS });
    for (const entry of batch) {
      const outcome = await run(entry);
      if (outcome.ok) result.sent += 1;
      else {
        result.failed += 1;
        result.errors.push(`${entry.kind} ${entry.targetId}: ${outcome.reason}`);
        if (outcome.stopAll) {
          result.stoppedBecause = outcome.reason;
          break;
        }
      }
    }
    result.remaining = waiting - result.sent;
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
    result.stoppedBecause = result.errors[result.errors.length - 1];
  }
  return result;
}
