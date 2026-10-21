import { randomInt } from "node:crypto";
import { sqlitePrisma } from "../lib/sqliteClient";
import { currentTenantKey } from "./context";
import { db } from "./rawDb";

/**
 * The short code of a frame or an accessory: what labels and the website show, while the id stays the internal key.
 *
 *   abc-123     3 lowercase letters, a dash, 3 digits
 *
 * Random, and unique within this shop's local database (across frames AND accessories, so a code names one product whatever its kind). Kept in
 * lowercase, never changed once given and never reused. This is a simple scheme for now; the unique rule per shop on the server is the safety net.
 */

export type ProductKind = "frame" | "accessory";

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const MAX_TRIES = 50;

/** A well-formed code as typed or scanned ("ABC-123 " counts); null when it is not one. Always in lowercase. */
export function normalizeCode(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const code = text.trim().toLowerCase();
  return /^[a-z]{3}-\d{3}$/.test(code) ? code : null;
}

/** One random code (not checked against anything). `kind` is accepted for the callers that know it; the code does not depend on it. */
export function randomCode(_kind?: ProductKind): string {
  let letters = "";
  for (let i = 0; i < 3; i++) letters += LETTERS[randomInt(LETTERS.length)];
  return `${letters}-${String(randomInt(1000)).padStart(3, "0")}`;
}

async function taken(tenantKey: string, code: string): Promise<boolean> {
  const where = { tenantKey, code };
  const [frame, accessory] = await Promise.all([
    sqlitePrisma.frame.findFirst({ where, select: { id: true } }),
    sqlitePrisma.accessory.findFirst({ where, select: { id: true } }),
  ]);
  return frame !== null || accessory !== null;
}

/** A code no frame or accessory of this shop has. */
export async function newProductCode(kind: ProductKind, tenantKey?: string): Promise<string> {
  const key = tenantKey ?? (await currentTenantKey());
  for (let i = 0; i < MAX_TRIES; i++) {
    const code = randomCode(kind);
    if (!(await taken(key, code))) return code;
  }
  throw new Error(`Could not find a free ${kind} code after ${MAX_TRIES} tries.`);
}

/**
 * Gives a code to every frame and accessory that has none (products made before codes existed). They are marked "not sent yet" so the
 * next sync pass tells the server. Run at every start; with nothing to do it costs two small queries. Returns how many were coded.
 */
export async function ensureProductCodes(): Promise<number> {
  let coded = 0;
  for (const kind of ["frame", "accessory"] as const) {
    const delegate = db[kind];
    const rows = await delegate.findMany({ where: { code: null }, select: { id: true, tenantKey: true } });
    for (const row of rows) {
      const code = await newProductCode(kind, String(row.tenantKey));
      const changed = await delegate.updateMany({ where: { id: row.id, code: null }, data: { code, synced: false } });
      coded += changed.count;
    }
  }
  return coded;
}
