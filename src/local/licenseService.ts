import { sqlitePrisma } from "../lib/sqliteClient";
import { LocalDbError } from "./errors";

/**
 * The licence's expiry date, kept in the local table `license_expiry` (one row, id 1, never sent to the server). The server hands the date out when the
 * shop registers (POST /api/register: today + 14 days); the app stores it here, together with the shop's own details (name, phone, address, the social
 * links) as they were typed in the activation form and accepted by the server.
 */

/** The shop's details, as stored. Every field but the name may be null. */
export interface ShopDetails {
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
}

/** What the activation form collected (empty or missing details are stored as nothing). */
export interface ShopInput {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  instagramUrl?: string | null;
  tiktokUrl?: string | null;
}

/** One line, trimmed, or null when empty. */
const oneLine = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text === "" ? null : text;
};

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "YYYY-MM-DD" -> that day at 00:00 UTC; a LocalDbError for anything that is not a real day. */
function parseDay(day: unknown): Date {
  const m = typeof day === "string" ? DAY.exec(day) : null;
  const date = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!m || !date || date.getUTCFullYear() !== Number(m[1]) || date.getUTCMonth() !== Number(m[2]) - 1 || date.getUTCDate() !== Number(m[3])) {
    throw new LocalDbError(`License expiry: "${String(day)}" is not a day like 2026-11-04.`, "invalid-input");
  }
  return date;
}

export const localLicenseService = {
  /**
   * Stores the expiry day ("YYYY-MM-DD"), replacing the one that was there. With `shop` (the activation: the server accepted the details and answered the
   * day) the shop's details are stored too, replacing the ones that were there; without it they are left as they are (a later check only moves the day).
   */
  async setExpiry(day: string, shop?: ShopInput): Promise<string> {
    const expiresAt = parseDay(day);
    // (details that came from the activation are details the server accepted: synced)
    const details = shop
      ? { synced: true, shopName: oneLine(shop.name), phone: oneLine(shop.phone), email: oneLine(shop.email), address: oneLine(shop.address), instagramUrl: oneLine(shop.instagramUrl), tiktokUrl: oneLine(shop.tiktokUrl) }
      : {};
    await sqlitePrisma.licenseExpiry.upsert({ where: { id: 1 }, create: { id: 1, expiresAt, ...details }, update: { expiresAt, ...details } });
    return expiresAt.toISOString().slice(0, 10);
  },

  /** The shop's details saved at activation, or null when none were saved (a copy that registered before they were kept). */
  async getShop(): Promise<ShopDetails | null> {
    const row = await sqlitePrisma.licenseExpiry.findUnique({ where: { id: 1 } });
    if (!row || [row.shopName, row.phone, row.email, row.address, row.instagramUrl, row.tiktokUrl].every((v) => v === null)) return null;
    return { name: row.shopName, phone: row.phone, email: row.email, address: row.address, instagramUrl: row.instagramUrl, tiktokUrl: row.tiktokUrl };
  },

  /** The stored expiry day ("YYYY-MM-DD"), or null when none was stored. */
  async getExpiry(): Promise<string | null> {
    const row = await sqlitePrisma.licenseExpiry.findUnique({ where: { id: 1 } });
    return row ? row.expiresAt.toISOString().slice(0, 10) : null;
  },
};
