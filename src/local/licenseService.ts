import { sqlitePrisma } from "../lib/sqliteClient";
import { LocalDbError } from "./errors";

/**
 * The licence's expiry date, kept in the local table `license_expiry` (one row, id 1, never sent to the server). The server hands the date out when the
 * shop registers (POST /api/register: today + 14 days); the app stores it here.
 */

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
  /** Stores the expiry day ("YYYY-MM-DD"), replacing the one that was there. */
  async setExpiry(day: string): Promise<string> {
    const expiresAt = parseDay(day);
    await sqlitePrisma.licenseExpiry.upsert({ where: { id: 1 }, create: { id: 1, expiresAt }, update: { expiresAt } });
    return expiresAt.toISOString().slice(0, 10);
  },

  /** The stored expiry day ("YYYY-MM-DD"), or null when none was stored. */
  async getExpiry(): Promise<string | null> {
    const row = await sqlitePrisma.licenseExpiry.findUnique({ where: { id: 1 } });
    return row ? row.expiresAt.toISOString().slice(0, 10) : null;
  },
};
