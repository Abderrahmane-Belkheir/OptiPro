import { localLicenseService } from "./licenseService";

/**
 * What happens when the server turns the shop away. The table API and the photo upload answer 401 with the code UNAUTHORIZED when the tenant key is
 * unknown or its licence has expired. The app then saves a very old expiry day in the local `license_expiry` table and closes (the main process plugs in
 * how, with setUnauthorizedHandler): the next start finds the old day and shows the expired page instead of the app (see main.ts).
 *
 * Only that exact answer counts: a network error, a timeout, a 429, a 5xx, a 403, or a 401 that does not carry the code UNAUTHORIZED (a proxy, a portal)
 * leaves the saved day alone.
 */

/** The day saved when the server refuses the key: long past, so the saved day is always before today. */
export const REFUSED_EXPIRY_DAY = "1970-01-01";

let handler: (() => void) | null = null;

/** Plugged in by the app at start (it closes the app); left out in tests and scripts, where only the day is saved. */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  handler = fn;
}

/** The server's answer is the one that counts: 401 with the code UNAUTHORIZED. */
export function isRefusal(status: number, code: unknown): boolean {
  return status === 401 && code === "UNAUTHORIZED";
}

let reported = false;

/** Called with every 401 the server sends; does nothing unless it is the refusal described above. Saves the old day, then calls the handler (once). */
export async function reportIfRefused(status: number, code: unknown): Promise<void> {
  if (!isRefusal(status, code)) return;
  console.warn(`[license] the server refused the tenant key (${status} ${String(code)}): saving the very old day ${REFUSED_EXPIRY_DAY} and stopping`);
  try {
    await localLicenseService.setExpiry(REFUSED_EXPIRY_DAY);
  } catch (err) {
    console.error("Could not save the old expiry day after the server refused the tenant key:", err);
  }
  if (!reported) {
    reported = true;
    handler?.();
  }
}

/** For tests: lets the handler run again. */
export function resetRefusalReport(): void {
  reported = false;
}
