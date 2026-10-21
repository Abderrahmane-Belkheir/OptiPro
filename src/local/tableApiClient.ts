import { requireServerUrl, requireTenantKey } from "../config";
import { reportIfRefused } from "./licenseGuard";

/**
 * The client of the server's table API: POST <server.url>/api/table/<name>?action=insert|update|delete with the shop's tenant
 * key (`Authorization: Bearer <key>`) and a JSON body. Every sync operation that writes rows or deletes them goes through here
 * (the sync of the tables, and the deletions of frames, accessories and photos); photo FILES are uploaded by imageService.ts.
 *
 *   insert  { "rows": [ {...}, ... ] }                                  insert, or overwrite the row with the same id
 *   update  { "where": { column: value }, "set": { column: value } }
 *   delete  { column: value }                                           the whole body is the condition
 *
 * callTable never throws: it answers { ok: true, body } or { ok: false, ... } saying whether asking again right now is pointless
 * (`stopAll`: no connection, a refused key, a missing setting, a failing server) and whether the cause was the connection itself
 * (`unreachable`, which is expected and not worth a warning).
 */

export type TableAction = "insert" | "update" | "delete";

export type TableCallResult =
  | { ok: true; body: Record<string, any>; warning?: string }
  | { ok: false; status: number; code: string; reason: string; stopAll: boolean; unreachable: boolean; body?: Record<string, any> };

const TIMEOUT_MS = 30_000;

/**
 * After a call could not reach the server at all, the next calls answer "unreachable" at once for a while instead of each
 * waiting for its own timeout (one sync pass would otherwise try every table). The sync pass lifts it when it starts.
 */
const CIRCUIT_MS = 60_000;
let blockedUntil = 0;
let blockedReason = "";

/** When the server last answered (with anything, even a refusal) and when a call last found it unreachable; epoch ms, or null. */
let lastReachedAt: number | null = null;
let lastUnreachableAt: number | null = null;

/** What the dashboard says about the connection: the server is reachable unless the latest call could not reach it. */
export function serverContact(): { lastReachedAt: number | null; lastUnreachableAt: number | null; reachable: boolean } {
  const reachable = lastUnreachableAt === null || (lastReachedAt !== null && lastReachedAt >= lastUnreachableAt);
  return { lastReachedAt, lastUnreachableAt, reachable };
}

export function resetTableApiCircuit(): void {
  blockedUntil = 0;
  blockedReason = "";
}

const failure = (status: number, code: string, reason: string, stopAll: boolean, unreachable = false, body?: Record<string, any>): TableCallResult => ({ ok: false, status, code, reason, stopAll, unreachable, body });

/** What the server said was wrong, in words: its message and, for a rejected body, the first problems with their rows. */
function describe(body: Record<string, any> | null, status: number): string {
  const said = typeof body?.error === "string" ? body.error : `The server answered ${status}.`;
  if (Array.isArray(body?.errors) && body.errors.length) {
    const first = body.errors.slice(0, 3).map((e: { row?: number; field?: string | null; message?: string }) => `row ${e.row ?? "?"}${e.field ? ` ${e.field}` : ""} ${e.message ?? ""}`.trim());
    return `${said} ${first.join("; ")}`;
  }
  return said;
}

/**
 * Requests are sent ONE AT A TIME, in the order they were asked for. Two requests on their way at once can arrive in either order,
 * and the wrong order is a wrong result: a sync pass sends the version of a product it read a moment ago while the user's edit sends
 * the newer one, and if the older one lands last the server keeps stale data (or a delete is undone by an insert that was already on
 * its way). One after the other, the last thing asked is the last thing the server hears.
 */
let tail: Promise<unknown> = Promise.resolve();

export function callTable(table: string, action: TableAction, body: unknown): Promise<TableCallResult> {
  const run = tail.then(() => send(table, action, body));
  tail = run.then(() => undefined, () => undefined);
  return run;
}

async function send(table: string, action: TableAction, body: unknown): Promise<TableCallResult> {
  if (Date.now() < blockedUntil) return failure(0, "UNREACHABLE", blockedReason, true, true);

  let server: string;
  let key: string;
  try {
    server = requireServerUrl();
    key = requireTenantKey();
  } catch (err) {
    return failure(0, "CONFIG", (err as Error).message, true);
  }

  let response: Response;
  try {
    response = await fetch(`${server}/api/table/${encodeURIComponent(table)}?action=${action}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    blockedReason = timedOut ? `The server did not answer within ${TIMEOUT_MS / 1000} seconds.` : `Can't reach the server at ${server}.`;
    blockedUntil = Date.now() + CIRCUIT_MS;
    lastUnreachableAt = Date.now();
    return failure(0, "UNREACHABLE", blockedReason, true, true);
  }
  lastReachedAt = Date.now();

  const answer = (await response.json().catch(() => null)) as Record<string, any> | null;
  const code = typeof answer?.code === "string" ? answer.code : "";
  if (response.ok) return { ok: true, body: answer ?? {} };
  // Deleted, but a photo file could not be removed from the server's storage: the delete itself happened.
  if (response.status === 500 && code === "FILE_REMOVAL_FAILED" && answer?.recordDeleted === true) {
    return { ok: true, body: answer, warning: typeof answer.error === "string" ? answer.error : "a photo file could not be removed from the server's storage" };
  }
  switch (response.status) {
    case 401:
      await reportIfRefused(401, code); // the server does not know this shop's key or its licence ended: an old expiry day is saved and the app closes
      return failure(401, code, "The server did not accept this shop's tenant key (tenant.key in the settings file).", true);
    case 429:
      return failure(429, code, typeof answer?.error === "string" ? answer.error : "Too many failed attempts. Try again in a few minutes.", true);
    default: {
      // A 404 with no code is not the table API talking (a server without it): the same for every table. Everything the API
      // refuses for the rows' sake (400, 403, 404 with a code, 409, 413, 422) concerns only this request.
      const stopAll = response.status >= 500 || (response.status === 404 && code === "") || response.status === 405;
      return failure(response.status, code, describe(answer, response.status), stopAll, false, answer ?? undefined);
    }
  }
}
