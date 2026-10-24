import { requireServerUrl, requireTenantKey } from "../config";
import { reportIfRefused } from "./licenseGuard";

/**
 * At start-up, when the settings file is complete, the app asks the server whether it still accepts the shop's key: GET <server.url>/api/expiry with the tenant key
 * (Authorization: Bearer <key>). This is the FIRST request of a run, and what the server answers decides:
 *
 *   200                             -> "valid": the key is accepted (the day the server sends is not kept: the server alone knows when the licence ends)
 *   401 UNAUTHORIZED                -> "refused": the key is unknown or the licence ended; the settings file is removed and the app stops (licenseGuard.ts)
 *   anything else, no network, no answer in time, a server without this address
 *                                   -> "offline": nothing changes and the app starts
 *
 * It never throws.
 */
export type ExpiryCheck = "valid" | "refused" | "offline";

export const EXPIRY_TIMEOUT_MS = 3_000;

/**
 * Asks the server about a tenant key and a server address given here (not the ones in the settings file) and changes nothing: how the app checks the key kept in the
 * renamed settings file, and the one used by checkExpiryWithServer below. "valid" only for a 200 that is the server's own answer; "refused" only for 401 UNAUTHORIZED.
 */
export async function checkKeyWithServer(server: string, key: string, fetchImpl: typeof fetch = fetch, timeoutMs: number = EXPIRY_TIMEOUT_MS): Promise<ExpiryCheck> {
  server = server.replace(/\/+$/, "");

  console.info(`[license] asking ${server}/api/expiry (waiting at most ${timeoutMs / 1000} s)`);
  const started = Date.now();
  let response: Response;
  try {
    response = await fetchImpl(`${server}/api/expiry`, { method: "GET", headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const cause = (err as { cause?: { code?: string } })?.cause?.code ?? (err as Error)?.name ?? "error";
    console.warn(`[license] the server did not answer after ${Date.now() - started} ms (${cause}): starting as usual`);
    return "offline"; // no network, no such server, no answer in time
  }

  const answer = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  console.info(`[license] the server answered ${response.status} in ${Date.now() - started} ms`);
  if (response.status === 401) {
    if (answer?.code !== "UNAUTHORIZED") {
      console.warn(`[license] a 401 that is not the server's own refusal (code: ${String(answer?.code)}): starting as usual`);
      return "offline"; // a 401 that is not this server's own refusal (a proxy, a portal)
    }
    return "refused";
  }
  if (response.status !== 200 || answer === null || !("expiry" in answer)) {
    console.warn(`[license] not the answer expected (status ${response.status}): starting as usual`);
    return "offline";
  }
  return "valid";
}

/** The start-up check with the settings file: like checkKeyWithServer, and the FIRST refusal renames the settings file and stops the app (licenseGuard.ts). It never throws. */
export async function checkExpiryWithServer(fetchImpl: typeof fetch = fetch, timeoutMs: number = EXPIRY_TIMEOUT_MS): Promise<ExpiryCheck> {
  let server: string;
  let key: string;
  try {
    server = requireServerUrl();
    key = requireTenantKey();
  } catch {
    console.warn("[license] no server address or tenant key in the settings: not asking the server");
    return "offline";
  }
  const answer = await checkKeyWithServer(server, key, fetchImpl, timeoutMs);
  if (answer === "refused") await reportIfRefused(401, "UNAUTHORIZED");
  return answer;
}
