import { sqlitePrisma } from "../lib/sqliteClient";
import { currentTenantKey } from "./context";
import { LocalDbError } from "./errors";

/**
 * Searching the shop's frames and accessories by what a person types (a name, a code, a maker's reference, a brand). Real rows from the local
 * database, nothing else. Every word typed has to match somewhere (name, code, reference or brand for a frame; name, code or description for an
 * accessory), in any case. Nothing typed gives the first ones in name order.
 *
 * `by` narrows what is looked at:
 *   "model"  a frame's name, maker's reference or brand; an accessory's name or description  (what a customer asks for: "aviator", "ray ban 3025")
 *   "code"   the product's own code (abc-123); "abc123" and capitals find it too              (what is on the label)
 *   "any"    all of them (the default)
 */
export type SearchBy = "any" | "code" | "model";
const searchBy = (by: unknown): SearchBy => (by === "code" || by === "model" ? by : "any");

/** A typed word as the codes that could match it: "ABC123" is also "abc-123" (a code is 3 letters, a dash, 3 digits). */
function codeVariants(word: string): string[] {
  const w = word.toLowerCase();
  const m = /^([a-z]{3})(\d+)$/.exec(w);
  return m ? [w, `${m[1]}-${m[2]}`] : [w];
}


/** What a picker needs to show and to choose a product. `price` is in the product's own currency, as it is stored (not cents). */
export interface ProductHit {
  id: string;
  code: string | null;
  name: string;
  /** A frame's brand; null for an accessory. */
  brand: string | null;
  /** The maker's own code (a frame), or null. */
  reference: string | null;
  price: number | null;
  currency: string | null;
  stock: number;
}

export const SEARCH_LIMIT_DEFAULT = 20;
export const SEARCH_LIMIT_MAX = 50;

export const CODE_HELP = "A code is 3 letters, a dash and 3 digits, like abc-123.";
export const MODEL_MAX_LENGTH = 60;
export const MODEL_MAX_WORDS = 6;
/** What a code can look like while it is being typed: 1 to 3 letters; 3 letters, an optional dash, up to 3 digits; or just the digits (1 to 3). */
const CODE_PARTIAL = /^(?:[a-z]{1,3}|[a-z]{3}-?[0-9]{0,3}|[0-9]{1,3})$/;
/** What a model, a reference or a brand is made of: letters (any alphabet), digits, spaces and . , ' ’ & + - / ( ). Nothing that means something to a database (% _ ; quotes...). */
const MODEL_CHARS = /^[\p{L}\p{M}\p{N} .,'’&+\-/()]+$/u;

/**
 * The structure of what is typed in a search box, checked before anything is searched. The same rules are applied in the New order form as the person
 * types (renderer/pages/newOrderForm.js, checkQuery) and again here, so a wrong input never reaches the database.
 *   - nothing (or only spaces): fine, there is nothing to search
 *   - by "code": a code is 3 letters, a dash and 3 digits, typed in part ("ab", "abc-1", "123"); capitals and spaces do not matter
 *   - by "model" (and "any"): letters, digits, spaces and . , ' & + - / ( ), at most 60 characters and 6 words
 * Answers the text to search for (cleaned up), or the sentence that says what is wrong.
 */
export function checkSearchInput(query: unknown, by: SearchBy): { ok: true; query: string } | { ok: false; message: string } {
  if (query === undefined || query === null) return { ok: true, query: "" };
  if (typeof query !== "string") return { ok: false, message: "The search must be text." };
  const trimmed = query.trim();
  if (trimmed === "") return { ok: true, query: "" };
  if (by === "code") {
    const code = trimmed.toLowerCase().replace(/\s+/g, "");
    return CODE_PARTIAL.test(code) ? { ok: true, query: code } : { ok: false, message: CODE_HELP };
  }
  const text = trimmed.replace(/\s+/g, " ");
  if (text.length > MODEL_MAX_LENGTH) return { ok: false, message: `That is too long: at most ${MODEL_MAX_LENGTH} characters.` };
  if (!MODEL_CHARS.test(text)) return { ok: false, message: "Only letters, digits, spaces and . , ' & + - / ( ) can be searched." };
  if (text.split(" ").length > MODEL_MAX_WORDS) return { ok: false, message: `Use at most ${MODEL_MAX_WORDS} words.` };
  return { ok: true, query: text };
}

/** The cleaned-up text to search for, or a LocalDbError (invalid-input) saying what is wrong with it. */
function validated(query: unknown, by: SearchBy): string {
  const checked = checkSearchInput(query, by);
  if (!checked.ok) throw new LocalDbError(`Search: ${checked.message}`, "invalid-input");
  return checked.query;
}

const words = (query: unknown): string[] => (typeof query === "string" ? query.trim().split(/\s+/).filter(Boolean).slice(0, 6) : []);
const limitOf = (limit: unknown): number => (typeof limit === "number" && Number.isInteger(limit) && limit > 0 ? Math.min(limit, SEARCH_LIMIT_MAX) : SEARCH_LIMIT_DEFAULT);

export async function searchFrames(query: string = "", limit?: number, by?: SearchBy): Promise<ProductHit[]> {
  const tenantKey = await currentTenantKey();
  const mode = searchBy(by);
  const text = validated(query, mode);
  const rows = await sqlitePrisma.frame.findMany({
    where: {
      tenantKey,
      AND: words(text).map((w) => ({
        OR: [
          ...(mode !== "code" ? [{ name: { contains: w } }, { reference: { contains: w } }, { brand: { is: { name: { contains: w } } } }] : []),
          ...(mode !== "model" ? codeVariants(w).map((c) => ({ code: { contains: c } })) : []),
        ],
      })),
    },
    include: { brand: { select: { name: true } } },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: limitOf(limit),
  });
  return rows.map((f) => ({ id: f.id, code: f.code, name: f.name, brand: f.brand.name, reference: f.reference, price: f.price, currency: f.currency, stock: f.stock }));
}

export async function searchAccessories(query: string = "", limit?: number, by?: SearchBy): Promise<ProductHit[]> {
  const tenantKey = await currentTenantKey();
  const mode = searchBy(by);
  const text = validated(query, mode);
  const rows = await sqlitePrisma.accessory.findMany({
    where: {
      tenantKey,
      AND: words(text).map((w) => ({
        OR: [
          ...(mode !== "code" ? [{ name: { contains: w } }, { description: { contains: w } }] : []),
          ...(mode !== "model" ? codeVariants(w).map((c) => ({ code: { contains: c } })) : []),
        ],
      })),
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: limitOf(limit),
  });
  return rows.map((a) => ({ id: a.id, code: a.code, name: a.name, brand: null, reference: null, price: a.price, currency: a.currency, stock: a.stock }));
}
