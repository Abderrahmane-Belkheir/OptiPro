import fs from "node:fs";
import Database from "better-sqlite3";
import { localDbPath } from "./lib/appData";

/**
 * What the local database already knows about the shop, for the first-run setup: when the settings file is missing but this computer still has its database
 * (the file was deleted, the app was reinstalled), the shop's details are in the licence row (table license_expiry) and the setup does not need to ask for
 * them again. It only LOOKS: the file is opened read-only, nothing is created, migrated or changed, and no database code of the app is loaded (the setup
 * runs before the app has any settings, so it must not make a database). It never throws: anything unexpected (no file, an older layout, a locked file)
 * means "nothing saved".
 */

export interface SavedShopDetails {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  instagramUrl?: string;
  tiktokUrl?: string;
}

export interface SavedShop {
  shop: SavedShopDetails;
}

const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined);

/** The shop saved in the local database, or null when there is no database, no licence row or no shop name in it. */
export function readSavedShop(): SavedShop | null {
  const file = localDbPath();
  if (!fs.existsSync(file)) return null;
  let db: Database.Database | null = null;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const has = (table: string) => db!.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;
    if (!has("license_expiry")) return null;
    const columns = (db.prepare(`PRAGMA table_info("license_expiry")`).all() as { name: string }[]).map((c) => c.name);
    if (!columns.includes("shop_name")) return null; // a database from before the shop's details were kept
    const row = db
      .prepare(`SELECT shop_name AS name, phone, email, address, instagram_url AS instagramUrl, tiktok_url AS tiktokUrl FROM license_expiry WHERE id = 1`)
      .get() as Record<string, unknown> | undefined;
    const name = text(row?.name);
    if (!row || !name) return null;
    const shop: SavedShopDetails = { name };
    for (const field of ["phone", "email", "address", "instagramUrl", "tiktokUrl"] as const) {
      const value = text(row[field]);
      if (value !== undefined) shop[field] = value;
    }
    return { shop };
  } catch (err) {
    console.warn("[setup] the local database could not be looked at:", (err as Error).message);
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      /* nothing to do */
    }
  }
}
