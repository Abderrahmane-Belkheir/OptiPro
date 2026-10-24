import { sqlitePrisma } from "../lib/sqliteClient";

/**
 * The shop's own details, kept in the local table `license_expiry` (one row, id 1; the table keeps its old name, but it no longer holds any date). They are the details typed
 * in the activation form and accepted by the server (name, phone, email, address, the social links), and what the shop edits later in the settings. Whether the licence has
 * ended is not kept here: only the server knows, and it says so by refusing the shop's key (see licenseGuard.ts).
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

export const localLicenseService = {
  /**
   * Stores the shop's details (the activation: the server accepted them), replacing the ones that were there. They are marked as known by the server.
   */
  async saveShop(shop: ShopInput): Promise<void> {
    const details = { synced: true, shopName: oneLine(shop.name), phone: oneLine(shop.phone), email: oneLine(shop.email), address: oneLine(shop.address), instagramUrl: oneLine(shop.instagramUrl), tiktokUrl: oneLine(shop.tiktokUrl) };
    await sqlitePrisma.licenseExpiry.upsert({ where: { id: 1 }, create: { id: 1, ...details }, update: details });
  },

  /** Makes sure the row exists (with no details), so the settings can edit the shop's information on a copy that registered before they were kept. */
  async ensureRow(): Promise<void> {
    await sqlitePrisma.licenseExpiry.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  },

  /** The shop's details saved at activation, or null when none were saved. */
  async getShop(): Promise<ShopDetails | null> {
    const row = await sqlitePrisma.licenseExpiry.findUnique({ where: { id: 1 } });
    if (!row || [row.shopName, row.phone, row.email, row.address, row.instagramUrl, row.tiktokUrl].every((v) => v === null)) return null;
    return { name: row.shopName, phone: row.phone, email: row.email, address: row.address, instagramUrl: row.instagramUrl, tiktokUrl: row.tiktokUrl };
  },
};
