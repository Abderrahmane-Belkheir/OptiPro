import { requireServerUrl, requireTenantKey } from "../config";
import { sqlitePrisma } from "../lib/sqliteClient";
import { LocalDbError } from "./errors";
import type { FieldErrors } from "./frameValidation";
import { reportIfRefused } from "./licenseGuard";
import { SHOP_INFO_FIELDS, validateShopInfoForm, type ShopInfoField, type ShopInfoForm } from "./shopInfoValidation";
import { syncFlag } from "./sync";

/**
 * The shop's own information (name, phone, email, address, Instagram, TikTok), kept in the local shop row (table license_expiry, which holds no date any more).
 * The settings page edits it; the server's copy is the shop's row of `tenants`, updated with POST <server.url>/api/infos (the tenant key as the Bearer token).
 *
 * The row has a `synced` flag, like the other tables:
 *   - true  : the server has these details (they came from the activation, or there are none);
 *   - false : from the moment they are edited until the server confirms them.
 * Saving writes the change locally first (synced = false) and then tries to send it; the server answering 200 sets synced = true. When it can not be
 * reached the details stay unsynced, and the sync pass (every 10 minutes, see syncScheduler.ts) sends them again.
 *
 * What is sent: the body always holds the six fields; the ones that are not being sent are null (the server ignores a null: nothing is cleared).
 *   - saving while everything was synced   -> only the fields that changed carry a value;
 *   - saving while an earlier change never arrived, and every later retry -> every field that has a value, so nothing that is waiting is lost.
 */

export interface ShopInfo {
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
  /** Whether the server has these details. (Not called `synced`: the window never sees a field of that name, see ipc/handlers.ts.) */
  onServer: boolean;
}

type Row = NonNullable<Awaited<ReturnType<typeof sqlitePrisma.licenseExpiry.findUnique>>>;
const COLUMN: Record<ShopInfoField, "shopName" | "phone" | "email" | "address" | "instagramUrl" | "tiktokUrl"> = {
  name: "shopName", phone: "phone", email: "email", address: "address", instagramUrl: "instagramUrl", tiktokUrl: "tiktokUrl",
};

const toInfo = (row: Row): ShopInfo => ({
  name: row.shopName, phone: row.phone, email: row.email, address: row.address, instagramUrl: row.instagramUrl, tiktokUrl: row.tiktokUrl, onServer: row.synced,
});

export const SHOP_INFO_TIMEOUT_MS = 15_000;

/** What the server did with an update. */
export type InfosOutcome = { ok: true } | { ok: false; reason: string; unreachable: boolean };

/**
 * POST <server.url>/api/infos with the tenant key and `body` (the six fields, a null where there is nothing to send). Never throws.
 *   200 { updated: true }   -> ok
 *   401 UNAUTHORIZED        -> the server turned the shop away: the settings file is removed and the app closes (licenseGuard.ts), like every other call
 *   anything else           -> not ok, with the reason in words (no connection, a refusal of the values, a failing server...)
 */
export async function postInfos(body: Record<ShopInfoField, string | null>, timeoutMs: number = SHOP_INFO_TIMEOUT_MS): Promise<InfosOutcome> {
  let server: string;
  let key: string;
  try {
    server = requireServerUrl();
    key = requireTenantKey();
  } catch (err) {
    return { ok: false, reason: (err as Error).message, unreachable: false };
  }
  let response: Response;
  try {
    response = await fetch(`${server}/api/infos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return { ok: false, reason: timedOut ? `The server did not answer within ${timeoutMs / 1000} seconds.` : `Can't reach the server at ${server}.`, unreachable: true };
  }
  const answer = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (response.status === 200 && answer?.updated === true) return { ok: true };
  if (response.status === 401) {
    await reportIfRefused(401, answer?.code);
    return { ok: false, reason: "The server did not accept this shop's tenant key.", unreachable: false };
  }
  const said = typeof answer?.error === "string" ? answer.error : `The server answered ${response.status}.`;
  return { ok: false, reason: said, unreachable: response.status >= 500 };
}

/** The body for an update: the six fields, each the row's value when it is to be sent and has one, otherwise null. */
function bodyFor(row: Row, send: readonly ShopInfoField[]): Record<ShopInfoField, string | null> {
  return Object.fromEntries(SHOP_INFO_FIELDS.map((field) => [field, send.includes(field) ? row[COLUMN[field]] : null])) as Record<ShopInfoField, string | null>;
}

/** Sends `send` of the row's fields. With nothing to send there is nothing to wait for: the row is synced. Marks it synced only if it was not edited meanwhile. */
async function pushFields(row: Row, send: readonly ShopInfoField[]): Promise<InfosOutcome> {
  const body = bodyFor(row, send);
  if (Object.values(body).every((v) => v === null)) {
    await sqlitePrisma.licenseExpiry.updateMany({ where: { id: 1, updatedAt: row.updatedAt }, data: { synced: true } });
    return { ok: true };
  }
  if (!syncFlag.push) return { ok: false, reason: "Sending to the server is turned off.", unreachable: true };
  const outcome = await postInfos(body);
  if (outcome.ok) await sqlitePrisma.licenseExpiry.updateMany({ where: { id: 1, updatedAt: row.updatedAt }, data: { synced: true } }); // (an edit made while the request was on its way keeps the row unsynced)
  else console.warn(`[sync] the shop's information was not sent: ${outcome.reason}`);
  return outcome;
}

const withValue = (row: Row): ShopInfoField[] => SHOP_INFO_FIELDS.filter((field) => row[COLUMN[field]] !== null);

export type SaveShopInfoResult =
  | { status: "invalid"; errors: FieldErrors }
  | { status: "unchanged"; info: ShopInfo }
  | { status: "saved"; info: ShopInfo; changed: ShopInfoField[]; sentToServer: boolean; reason?: string };

export type ShopInfoPushResult =
  /** Everything was already synced. */
  | { status: "nothing-pending" }
  | { status: "sent" }
  | { status: "failed"; reason: string; unreachable: boolean };

export const localShopInfoService = {
  /** The shop's details as saved on this computer (with whether the server has them), or null when this computer has no licence row yet. */
  async get(): Promise<ShopInfo | null> {
    const row = await sqlitePrisma.licenseExpiry.findUnique({ where: { id: 1 } });
    return row ? toInfo(row) : null;
  },

  /**
   * Saves what changed and sends it. `form` holds the fields the person typed: an empty or missing one means "leave it". Only a value that differs from
   * the current one is a change. Answers { status: "invalid", errors } (nothing saved), { status: "unchanged" } (nothing differs: nothing saved, nothing
   * sent), or { status: "saved", changed, sentToServer }: the change is saved here whatever the server says; sentToServer is false (with the reason) when
   * the server could not take it now, and the sync pass sends it later.
   */
  async save(form: ShopInfoForm): Promise<SaveShopInfoResult> {
    const checked = validateShopInfoForm(form);
    if (checked.errors) return { status: "invalid", errors: checked.errors };
    const row = await sqlitePrisma.licenseExpiry.findUnique({ where: { id: 1 } });
    if (!row) throw new LocalDbError("Shop information: this computer has no record of the licence yet, so there is nowhere to keep the details. Start the app with the server reachable once.", "not-found");

    const changed = SHOP_INFO_FIELDS.filter((field) => checked.values[field] !== undefined && checked.values[field] !== row[COLUMN[field]]);
    if (changed.length === 0) return { status: "unchanged", info: toInfo(row) };

    const wasSynced = row.synced;
    const data = Object.fromEntries(changed.map((field) => [COLUMN[field], checked.values[field]]));
    const saved = await sqlitePrisma.licenseExpiry.update({ where: { id: 1 }, data: { ...data, synced: false } });
    const outcome = await pushFields(saved, wasSynced ? changed : withValue(saved));
    const info = toInfo((await sqlitePrisma.licenseExpiry.findUnique({ where: { id: 1 } }))!);
    return { status: "saved", info, changed, sentToServer: outcome.ok, ...(outcome.ok ? {} : { reason: outcome.reason }) };
  },

  /** Whether the details are waiting for the server (checked by the sync pass). */
  async isPending(): Promise<boolean> {
    return (await sqlitePrisma.licenseExpiry.count({ where: { id: 1, synced: false } })) > 0;
  },

  /** Sends the details again if the server does not have them yet (every field that has a value). Called by the sync pass; never throws on a refusal. */
  async pushPending(): Promise<ShopInfoPushResult> {
    const row = await sqlitePrisma.licenseExpiry.findUnique({ where: { id: 1 } });
    if (!row || row.synced) return { status: "nothing-pending" };
    const outcome = await pushFields(row, withValue(row));
    return outcome.ok ? { status: "sent" } : { status: "failed", reason: outcome.reason, unreachable: outcome.unreachable };
  },
};
