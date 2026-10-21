/**
 * The first-run setup: the person types the shop's tenant key, its server address and its details, and Confirm sends them to the server
 * (POST <server.url>/api/register, Authorization: Bearer <tenant key>). What the server answers decides what happens next:
 *
 *   200 registered            -> "activated": the settings file is written (tenant.key and server.url), the expiry day the server answered is kept
 *                                (the main process stores it in the local database once it is open) and the app starts
 *   400 / 409 / 413           -> "invalid": the details are wrong (a bad e-mail, an address another shop uses...): the form stays open with the
 *                                server's words, nothing is written
 *   401 (unauthorized key), 429, 5xx, any other answer, no network, no answer in time
 *                             -> "invalid" as well: the form stays open with a message (a wrong key or a mistyped address look the same from here),
 *                                nothing is written, and the person can correct the details and press Confirm again. The app never closes because of this.
 *
 * Nothing here touches Electron or the database, so it can be tested on its own.
 */

/** What the form sends. Optional fields may be left empty. */
export interface SetupInput {
  tenantKey: string;
  serverUrl: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  instagramUrl?: string;
  tiktokUrl?: string;
}

export type SetupOutcome =
  | { kind: "activated"; tenantKey: string; serverUrl: string; expiry: string }
  | { kind: "invalid"; message: string; field?: keyof SetupInput };

/** The same shape the servers accept for a tenant key (backend/src/lib/imageUpload.js SAFE_KEY). */
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const OPTIONAL: (keyof SetupInput)[] = ["phone", "email", "address", "instagramUrl", "tiktokUrl"];
export const REGISTER_TIMEOUT_MS = 15_000;
const EXPIRY_DAY = /^\d{4}-\d{2}-\d{2}$/;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** The form's values cleaned up (trimmed, no trailing slash on the address), or the first thing wrong with them. No request is made for a form that is wrong. */
export function checkSetupInput(raw: unknown): { input: SetupInput } | { outcome: SetupOutcome } {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const invalid = (message: string, field: keyof SetupInput): { outcome: SetupOutcome } => ({ outcome: { kind: "invalid", message, field } });

  const tenantKey = text(source.tenantKey);
  if (!tenantKey) return invalid("Enter the tenant key.", "tenantKey");
  if (!SAFE_KEY.test(tenantKey)) return invalid("The tenant key may only contain letters, digits, dots, dashes and underscores.", "tenantKey");

  const serverUrl = text(source.serverUrl).replace(/\/+$/, "");
  if (!serverUrl) return invalid("Enter the server address.", "serverUrl");
  try {
    if (!/^https?:$/.test(new URL(serverUrl).protocol)) throw new Error("not http");
  } catch {
    return invalid("The server address must be a web address starting with https:// (or http://).", "serverUrl");
  }

  const name = text(source.name);
  if (!name) return invalid("Enter the shop's name.", "name");

  const input: SetupInput = { tenantKey, serverUrl, name };
  for (const field of OPTIONAL) {
    const value = text(source[field]);
    if (value) input[field] = value;
  }
  return { input };
}

/** What the form says when the server refuses or cannot be reached. The field is where to look first. */
const REFUSED: { message: string; field?: keyof SetupInput } = {
  message: "The server did not accept the tenant key. Check the key and the server address, then try again.",
  field: "tenantKey",
};
const UNREACHABLE: { message: string; field?: keyof SetupInput } = {
  message: "The server can't be reached. Check the internet connection and the server address, then try again.",
  field: "serverUrl",
};
const TOO_MANY: { message: string; field?: keyof SetupInput } = { message: "Too many attempts. Wait a few minutes, then try again." };
const FAILED: { message: string; field?: keyof SetupInput } = { message: "The server could not complete the activation. Try again in a moment." };

/**
 * A flaky connection is common: the request is tried up to REGISTER_ATTEMPTS times, with a short wait between tries. It is only tried again when the
 * request certainly never reached the server (the connection could not be made: refused, timed out while connecting, no DNS answer) or the server's
 * front door was briefly closed (502 or 503). It is NOT tried again when the answer is unknown (the request was sent and no answer came back in time):
 * registering is allowed once, so if that first try had worked, trying again would only be refused.
 */
export const REGISTER_ATTEMPTS = 3;
export const REGISTER_RETRY_WAITS_MS = [1_000, 2_000];
const CONNECTION_FAILURES = new Set(["UND_ERR_CONNECT_TIMEOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "ECONNABORTED"]);

/** True when a failed fetch never got as far as sending the request. */
function neverReachedTheServer(error: unknown): boolean {
  const seen: unknown[] = [error, (error as { cause?: unknown })?.cause];
  const cause = seen[1] as { errors?: unknown[] } | undefined;
  if (Array.isArray(cause?.errors)) seen.push(...cause!.errors!);
  return seen.some((e) => typeof (e as { code?: unknown })?.code === "string" && CONNECTION_FAILURES.has((e as { code: string }).code));
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Sends the shop's details to the server and decides what the answer means (see the top of this file). `fetchImpl` is a parameter so a test can
 * stand in for the network, and `waits` the pauses between tries. Never throws.
 */
export async function activate(
  raw: unknown,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = REGISTER_TIMEOUT_MS,
  waits: number[] = REGISTER_RETRY_WAITS_MS,
): Promise<SetupOutcome> {
  const checked = checkSetupInput(raw);
  if ("outcome" in checked) return checked.outcome;
  const { tenantKey, serverUrl, ...shop } = checked.input;

  let response: Response | null = null;
  for (let attempt = 1; attempt <= REGISTER_ATTEMPTS; attempt++) {
    const last = attempt === REGISTER_ATTEMPTS;
    console.info(`[setup] registering with ${serverUrl} (try ${attempt} of ${REGISTER_ATTEMPTS})`);
    try {
      response = await fetchImpl(`${serverUrl}/api/register`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tenantKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(shop),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const code = (error as { cause?: { code?: string } })?.cause?.code ?? (error as Error)?.name ?? "error";
      console.warn(`[setup] try ${attempt} failed (${code})${!last && neverReachedTheServer(error) ? ": the request never reached the server, trying again" : ""}`);
      if (!last && neverReachedTheServer(error)) {
        await wait(waits[attempt - 1] ?? 0);
        continue;
      }
      return { kind: "invalid", ...UNREACHABLE }; // no network, no such server, no answer in time
    }
    console.info(`[setup] the server answered ${response.status}`);
    if (!last && (response.status === 502 || response.status === 503)) {
      console.warn("[setup] the server's front door was briefly closed, trying again");
      await wait(waits[attempt - 1] ?? 0);
      continue;
    }
    break;
  }
  if (response === null) return { kind: "invalid", ...UNREACHABLE };

  const answer = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (response.status === 200) {
    // A 200 that is not this endpoint's answer (no "registered", no expiry day like 2026-11-04) is not our server's.
    return answer?.registered === true && typeof answer.expiry === "string" && EXPIRY_DAY.test(answer.expiry)
      ? { kind: "activated", tenantKey, serverUrl, expiry: answer.expiry }
      : { kind: "invalid", ...FAILED };
  }
  if (response.status === 400 || response.status === 409 || response.status === 413) {
    const field = typeof answer?.field === "string" && field_names.has(answer.field) ? (answer.field as keyof SetupInput) : undefined;
    return { kind: "invalid", message: typeof answer?.error === "string" ? answer.error : "The server did not accept the shop's details.", ...(field ? { field } : {}) };
  }
  if (response.status === 401) return { kind: "invalid", ...REFUSED };
  if (response.status === 429) return { kind: "invalid", ...TOO_MANY };
  return { kind: "invalid", ...FAILED };
}

const field_names = new Set<string>(["name", "phone", "email", "address", "instagramUrl", "tiktokUrl"]);
