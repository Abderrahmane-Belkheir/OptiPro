import { countUploadablePhotos, pushPendingPhotos, type PhotoPushResult } from "./photoService";
import { countPendingDeletions, pushPendingDeletions, type DeletionPushResult } from "./pendingDeletions";
import { syncFlag } from "./sync";
import { resetTableApiCircuit, serverContact } from "./tableApiClient";
import { countPending, pushTable, SYNC_ORDER, type PushTableResult, type SyncTable } from "./syncPush";
import { checkUnsynced } from "./syncStatus";
import { localShopInfoService, type ShopInfoPushResult } from "./shopInfoService";

/**
 * Pushes everything that is waiting, on a schedule: once at the very start, then every 10 minutes.
 *
 * Each pass (pushAll) goes through the tables parents first (SYNC_ORDER) and runs pushTable on each,
 * so one pass releases a whole chain — a customer, its prescription, the order, its lines, the
 * payments, the invoice. Rows whose parent still isn't synced are left for a later pass.
 *
 * First of all, the DELETIONS: a frame, accessory, photo or brand deleted on this computer whose deletion the server has not
 * been told yet (the outbox, pendingDeletions.ts) is sent to the server (the table API, action delete).
 *
 * The shop's own DETAILS (name, phone, address, social links) come next: when they were edited in the settings and the server has not confirmed them (the
 * licence row's `synced` is false) they are sent again (POST /api/infos, shopInfoService.ts).
 *
 * After the tables, the PHOTOS: every product_images row that is not synced and whose frame or accessory is
 * synced is read from the app's images folder and uploaded to the server (pushPendingPhotos). They come after
 * the tables so a frame that became synced in this very pass has its photos uploaded in the same pass.
 *
 * A pass is cheap when there is nothing to do and never piles up:
 *   - it first counts pending rows locally; with none, it ends without touching the network;
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
   *  pushed               ran the tables and/or the photos (see `tables` and `photos`; `sent` may still be 0 if the remote database refused rows)
   *  nothing-to-push      no row has synced = 0, no photo can be uploaded and no deletion is waiting
   *  disabled             syncFlag.push is false
   *  database-unavailable  the remote database could not be reached; nothing was attempted
   *  config-error         config.properties is missing or incomplete
   *  already-running      another pass was in progress; this one did nothing
   */
  outcome: "pushed" | "nothing-to-push" | "disabled" | "database-unavailable" | "config-error" | "already-running";
  /** Only the tables that had pending rows. */
  tables: PushTableResult[];
  sent: number;
  /** Rows still waiting for a parent after this pass. */
  held: number;
  /** What happened to the photos of frames and accessories that are on the server (see pushPendingPhotos). */
  photos: PhotoPushResult;
  /** What happened to the deletions the server had not been told about yet (see pushPendingDeletions). */
  deletions: DeletionPushResult;
  /** What happened to the shop's own details when they were waiting for the server (see localShopInfoService.pushPending); null when they were not. */
  shopInfo: ShopInfoPushResult | null;
  errors: { table?: SyncTable; message: string }[];
}

let running = false;
let last: SyncRun | null = null;
let lastGood: SyncRun | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

/** The most recent finished pass, or null before the first one. */
export function lastSyncRun(): SyncRun | null {
  return last;
}

/** The most recent pass that reached the server and ended without an error, or null. */
export function lastGoodSyncRun(): SyncRun | null {
  return lastGood;
}

/** One pass over all tables, parents first. */
export async function pushAll(trigger: SyncRun["trigger"] = "manual"): Promise<SyncRun> {
  const startedAt = new Date().toISOString();
  const done = (outcome: SyncRun["outcome"], rest: Partial<SyncRun> = {}): SyncRun => ({
    startedAt, finishedAt: new Date().toISOString(), trigger, outcome, tables: [], sent: 0, held: 0, photos: { uploaded: 0, failed: 0, remaining: 0, errors: [] }, deletions: { sent: 0, failed: 0, remaining: 0, errors: [] }, shopInfo: null, errors: [], ...rest,
  });

  /** A pass that could not start: a missing config.properties is one thing, anything else means the remote database. */
  const failed = (err: unknown): SyncRun =>
    done(err instanceof Error && err.name === "ConfigError" ? "config-error" : "database-unavailable", {
      errors: [{ message: err instanceof Error ? err.message : String(err) }],
    });

  if (running) return done("already-running");
  running = true;
  try {
    if (!syncFlag.push) return remember(done("disabled"));
    resetTableApiCircuit(); // a server that could not be reached a moment ago is tried again by this pass

    const pending = await countPending();
    const tablesPending = Object.values(pending).some((count) => count > 0);
    const infoPending = await localShopInfoService.isPending();
    if (!tablesPending && !infoPending && (await countUploadablePhotos()) === 0 && (await countPendingDeletions()) === 0) {
      await checkUnsynced().catch(() => undefined); // keeps syncState.synced accurate
      return remember(done("nothing-to-push"));
    }

    const errors: SyncRun["errors"] = [];

    // Deletions FIRST. A deleted brand's name can be used again at once: if the new brand were sent first, the server would answer with
    // the old brand's id (a brand is the same brand by its name) and the old brand's deletion would then remove it. Nothing else
    // depends on the order: a deleted product's row is gone here, so nothing of it can be sent again.
    const deletions = await pushPendingDeletions();
    if (deletions.stoppedBecause) errors.push({ message: `deletions: stopped (${deletions.stoppedBecause})` });

    // The shop's details: only when the settings edited them and the server has not confirmed yet.
    let shopInfo: ShopInfoPushResult | null = null;
    if (infoPending) {
      shopInfo = await localShopInfoService.pushPending();
      if (shopInfo.status === "failed") errors.push({ message: `shop information: not sent (${shopInfo.reason})` });
    }

    const tables: PushTableResult[] = [];
    if (tablesPending) {
      for (const table of SYNC_ORDER) {
        if (!pending[table]) continue; // nothing waiting in this table, so no request for it
        try {
          tables.push(await pushTable(table));
        } catch (err) {
          errors.push({ table, message: err instanceof Error ? err.message : String(err) });
        }
      }
    }

    // The photos of the frames and accessories that are on the server (including ones that just got there).
    const photos = await pushPendingPhotos();
    if (photos.stoppedBecause) errors.push({ message: `photos: stopped (${photos.stoppedBecause})` });

    await checkUnsynced().catch(() => undefined);
    const run = done("pushed", { tables, photos, deletions, shopInfo, errors, sent: tables.reduce((n, t) => n + t.sent, 0), held: tables.reduce((n, t) => n + t.held, 0) });
    if (run.sent || run.held || run.errors.length || photos.uploaded || photos.failed || deletions.sent || deletions.failed) {
      const parts = [`sent ${run.sent} row(s)`];
      if (run.held) parts.push(`${run.held} waiting for a parent`);
      if (photos.uploaded || photos.failed) parts.push(`photos: ${photos.uploaded} uploaded${photos.failed ? `, ${photos.failed} failed` : ""}${photos.remaining ? `, ${photos.remaining} waiting` : ""}`);
      if (deletions.sent || deletions.failed) parts.push(`deletions: ${deletions.sent} sent${deletions.failed ? `, ${deletions.failed} failed` : ""}${deletions.remaining ? `, ${deletions.remaining} waiting` : ""}`);
      if (run.errors.length) parts.push(`${run.errors.length} error(s)`);
      console.log(`[sync] ${run.trigger}: ${parts.join(", ")}`);
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
  // "Synced" means the server confirmed it: nothing was waiting, or it answered during this pass and no call found it unreachable.
  const contact = serverContact();
  const started = Date.parse(run.startedAt);
  const reached = contact.lastReachedAt !== null && contact.lastReachedAt >= started && (contact.lastUnreachableAt === null || contact.lastUnreachableAt < started);
  if (run.errors.length === 0 && (run.outcome === "nothing-to-push" || (run.outcome === "pushed" && reached))) lastGood = run;
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
