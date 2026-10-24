import { renameSettingsToExpired } from "../config";

/**
 * What happens when the server turns the shop away. The table API, the infos, the photo upload and the start-up check answer 401 with the code UNAUTHORIZED
 * when the tenant key is unknown or its licence has expired. The FIRST such answer:
 *   1. renames the settings file to config.properties.expired (tenant.key and server.url stay in it): the next start asks the server about that key; if the server
 *      accepts it the file gets its name back, if not (or the server cannot be reached) the setup page opens with the key and the address filled in;
 *   2. calls the handler the main process plugs in (setUnauthorizedHandler): it stops the sync and replaces the app's windows with the page that says the licence
 *      has expired, and the app ends when that page is closed.
 * Nothing about the licence is kept on this computer: the server is the only one that knows if it has ended.
 *
 * Only that exact answer counts: a network error, a timeout, a 429, a 5xx, a 403, or a 401 that does not carry the code UNAUTHORIZED (a proxy, a portal)
 * changes nothing. The setup page (activation) does not use this: a wrong key there is only an error on the page, it never removes anything.
 */

let handler: (() => void) | null = null;

/** Plugged in by the app at start (it stops the app); left out in tests and scripts, where only the settings file is renamed. */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  handler = fn;
}

/** The server's answer is the one that counts: 401 with the code UNAUTHORIZED. */
export function isRefusal(status: number, code: unknown): boolean {
  return status === 401 && code === "UNAUTHORIZED";
}

let reported = false;

/** Called with every 401 the server sends; does nothing unless it is the refusal described above. Acts on the first one only. */
export async function reportIfRefused(status: number, code: unknown): Promise<void> {
  if (!isRefusal(status, code)) return;
  if (reported) return;
  reported = true;
  console.warn(`[license] the server refused the tenant key (${status} ${String(code)}): renaming the settings file and stopping`);
  renameSettingsToExpired();
  handler?.();
}

/** For tests: lets the next refusal act again. */
export function resetRefusalReport(): void {
  reported = false;
}
