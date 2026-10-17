import { categoryService } from "../services/categoryService";
import { syncFlag } from "./sync";
import { countPending, pushTable, SYNC_ORDER, type PushTableResult, type SyncTable } from "./syncPush";
import { checkUnsynced } from "./syncStatus";

/**
 * Pushes everything that is waiting, on a schedule: once at the very start, then every 10 minutes.
 *
 * Each pass (pushAll) goes through the tables parents first (SYNC_ORDER) and runs pushTable on each,
 * so one pass releases a whole chain — a customer, its prescription, the order, its lines, the
 * payments, the invoice. Rows whose parent still isn't synced are left for a later pass.
 *
 * A pass is cheap when there is nothing to do and never piles up:
 *   - it first counts pending rows locally; with none, it ends without touching the network;
 *   - it pings the backend once; if that fails the pass ends there, instead of every table waiting
 *     out its own timeout, and the next scheduled pass tries again;
 *   - a pass that is still running makes any other trigger (timer or manual) return "already-running";
 *   - syncFlag.push = false turns the pass into a no-op.
 * Nothing here throws: what happened is in the returned SyncRun and in lastSyncRun().
 */

export const SYNC_INTERVAL_MS = 10 * 60 * 1000;

export interface SyncRun {
  startedAt: string;
  finishedAt: string;
  /** What started the pass. */
  trigger: "start" | "timer" | "manual";
  /**
   *  pushed               ran the tables (see `tables`; `sent` may still be 0 if the backend refused rows)
   *  nothing-to-push      no row has synced = 0
   *  disabled             syncFlag.push is false
   *  backend-unavailable  the backend could not be reached; nothing was attempted
   *  config-error         config.properties is missing or incomplete
   *  already-running      another pass was in progress; this one did nothing
   */
  outcome: "pushed" | "nothing-to-push" | "disabled" | "backend-unavailable" | "config-error" | "already-running";
  /** Only the tables that had pending rows. */
  tables: PushTableResult[];
  sent: number;
  /** Rows still waiting for a parent after this pass. */
  held: number;
  errors: { table?: SyncTable; message: string }[];
}

let running = false;
let last: SyncRun | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

/** The most recent finished pass, or null before the first one. */
export function lastSyncRun(): SyncRun | null {
  return last;
}

/** One pass over all tables, parents first. */
export async function pushAll(trigger: SyncRun["trigger"] = "manual"): Promise<SyncRun> {
  const startedAt = new Date().toISOString();
  const done = (outcome: SyncRun["outcome"], rest: Partial<SyncRun> = {}): SyncRun => ({
    startedAt, finishedAt: new Date().toISOString(), trigger, outcome, tables: [], sent: 0, held: 0, errors: [], ...rest,
  });

  /** A pass that could not start: a missing config.properties is one thing, anything else means the backend. */
  const failed = (err: unknown): SyncRun =>
    done(err instanceof Error && err.name === "ConfigError" ? "config-error" : "backend-unavailable", {
      errors: [{ message: err instanceof Error ? err.message : String(err) }],
    });

  if (running) return done("already-running");
  running = true;
  try {
    if (!syncFlag.push) return remember(done("disabled"));

    const pending = await countPending();
    if (Object.values(pending).every((count) => count === 0)) {
      await checkUnsynced().catch(() => undefined); // keeps syncState.synced accurate
      return remember(done("nothing-to-push"));
    }

    // One cheap read tells whether the backend is there before 12 tables each try on their own.
    try {
      await categoryService.list();
    } catch (err) {
      return remember(failed(err));
    }

    const tables: PushTableResult[] = [];
    const errors: SyncRun["errors"] = [];
    for (const table of SYNC_ORDER) {
      if (!pending[table]) continue; // nothing waiting in this table, so no request for it
      try {
        tables.push(await pushTable(table));
      } catch (err) {
        errors.push({ table, message: err instanceof Error ? err.message : String(err) });
      }
    }
    await checkUnsynced().catch(() => undefined);
    const run = done("pushed", { tables, errors, sent: tables.reduce((n, t) => n + t.sent, 0), held: tables.reduce((n, t) => n + t.held, 0) });
    if (run.sent || run.held || run.errors.length) {
      console.log(`[sync] ${run.trigger}: sent ${run.sent} row(s)${run.held ? `, ${run.held} waiting for a parent` : ""}${run.errors.length ? `, ${run.errors.length} error(s)` : ""}`);
    }
    return remember(run);
  } catch (err) {
    return remember(failed(err));
  } finally {
    running = false;
  }
}

function remember(run: SyncRun): SyncRun {
  last = run;
  return run;
}

/**
 * Starts the schedule: a pass right now (not awaited — the window doesn't wait for it), then one
 * every `intervalMs` (10 minutes). Calling it twice does nothing. Returns a function that stops it.
 */
export function startSyncScheduler(options: { intervalMs?: number } = {}): () => void {
  if (!timer) {
    void pushAll("start");
    timer = setInterval(() => void pushAll("timer"), options.intervalMs ?? SYNC_INTERVAL_MS);
  }
  return stopSyncScheduler;
}

export function stopSyncScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
