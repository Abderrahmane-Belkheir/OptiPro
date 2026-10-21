import { requireServerUrl, requireTenantKey } from "../config";
import { reportIfRefused } from "./licenseGuard";
import { localLicenseService } from "./licenseService";

/**
 * At start-up, when the settings file is complete, the app asks the server for the licence's expiry day: GET <server.url>/api/expiry with the tenant key
 * (Authorization: Bearer <key>). What the server answers decides:
 *
 *   200 { "expiry": "YYYY-MM-DD" }  -> "valid": the day is saved in the local license_expiry table (replacing the one that was there)
 *   200 { "expiry": null }          -> "valid": the server holds no day; the local one stays
 *   401 UNAUTHORIZED                -> "refused": the key is unknown or the licence ended; a very old day is saved locally and the app closes (licenseGuard.ts)
 *   anything else, no network, no answer in time, a server without this address
 *                                   -> "offline": nothing changes; the caller validates with the expiry day saved locally
 *
 * It never throws.
 */
export type ExpiryCheck = "valid" | "refused" | "offline";

export const EXPIRY_TIMEOUT_MS = 3_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function checkExpiryWithServer(fetchImpl: typeof fetch = fetch, timeoutMs: number = EXPIRY_TIMEOUT_MS): Promise<ExpiryCheck> {
  let server: string;
  let key: string;
  try {
    server = requireServerUrl();
    key = requireTenantKey();
  } catch {
    console.warn("[license] no server address or tenant key in the settings: not asking the server, the day saved locally decides");
    return "offline";
  }

  console.info(`[license] asking ${server}/api/expiry (waiting at most ${timeoutMs / 1000} s)`);
  const started = Date.now();
  let response: Response;
  try {
    response = await fetchImpl(`${server}/api/expiry`, { method: "GET", headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const cause = (err as { cause?: { code?: string } })?.cause?.code ?? (err as Error)?.name ?? "error";
    console.warn(`[license] the server did not answer after ${Date.now() - started} ms (${cause}): the day saved locally decides`);
    return "offline"; // no network, no such server, no answer in time
  }

  const answer = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  console.info(`[license] the server answered ${response.status} in ${Date.now() - started} ms`);
  if (response.status === 401) {
    if (answer?.code !== "UNAUTHORIZED") {
      console.warn(`[license] a 401 that is not the server's own refusal (code: ${String(answer?.code)}): the day saved locally decides`);
      return "offline"; // a 401 that is not this server's own refusal (a proxy, a portal)
    }
    await reportIfRefused(401, answer.code);
    return "refused";
  }
  if (response.status !== 200 || answer === null || !("expiry" in answer)) {
    console.warn(`[license] not the answer expected (status ${response.status}): the day saved locally decides`);
    return "offline";
  }
  if (answer.expiry === null) {
    console.info("[license] the server holds no expiry day: the day saved locally stays");
    return "valid";
  }
  if (typeof answer.expiry !== "string" || !DAY.test(answer.expiry)) {
    console.warn("[license] the server's expiry day is not a day like 2026-11-04: ignored, the day saved locally decides");
    return "offline";
  }
  try {
    await localLicenseService.setExpiry(answer.expiry);
    console.info(`[license] the server says the licence ends on ${answer.expiry}: saved locally`);
  } catch (err) {
    console.error("Could not save the expiry day the server sent:", err);
  }
  return "valid";
}
