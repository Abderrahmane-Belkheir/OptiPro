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

/** Every typed word has to match a frame somewhere: its name, reference or brand (by model), its code (by code), or any of them. */
function frameWords(text: string, mode: SearchBy) {
  return words(text).map((w) => ({
    OR: [
      ...(mode !== "code" ? [{ name: { contains: w } }, { reference: { contains: w } }, { brand: { is: { name: { contains: w } } } }] : []),
      ...(mode !== "model" ? codeVariants(w).map((c) => ({ code: { contains: c } })) : []),
    ],
  }));
}

export const FRAMES_SEARCH_LIMIT = 60;

/**
 * The ids of the frames that match what was typed, in name order, for the Frames page. A brand and a category narrow the search WHEN THEY ARE GIVEN (the
 * page gives the ones that are chosen); left out, the search looks at all the shop's frames and only what was typed counts. At most `limit` (default 60,
 * at most 120); one more than asked is read so the page can say there are more, which is why it is the caller that cuts.
 */
export async function searchFrameIds(query: string = "", by?: SearchBy, filter: { brandId?: string | null; categoryId?: number | null; outOfStock?: boolean; notOrdered?: boolean } = {}, limit?: number): Promise<string[]> {
  const tenantKey = await currentTenantKey();
  const mode = searchBy(by);
  const text = validated(query, mode);
  const brandId = typeof filter?.brandId === "string" && filter.brandId !== "" ? filter.brandId : undefined;
  const categoryId = typeof filter?.categoryId === "number" && Number.isInteger(filter.categoryId) ? filter.categoryId : undefined;
  const take = typeof limit === "number" && Number.isInteger(limit) && limit > 0 ? Math.min(limit, 120) : FRAMES_SEARCH_LIMIT;
  const rows = await sqlitePrisma.frame.findMany({
    where: { tenantKey, ...(brandId ? { brandId } : {}), ...(categoryId !== undefined ? { categoryId } : {}), ...(filter?.outOfStock === true ? { stock: 0 } : {}),
      // (notOrdered: no line of a supplier order is waiting for this frame, i.e. none with used = false: it was ordered while it still had stock)
      ...(filter?.notOrdered === true ? { supplierOrderItems: { none: { used: false } } } : {}), AND: frameWords(text, mode) },
    select: { id: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: take + 1,
  });
  return rows.map((r) => r.id);
}

/** filter.inStock: only the frames (or accessories) with at least one piece in stock: what a customer's order can be made with. */
export async function searchFrames(query: string = "", limit?: number, by?: SearchBy, filter: { inStock?: boolean } = {}): Promise<ProductHit[]> {
  const tenantKey = await currentTenantKey();
  const mode = searchBy(by);
  const text = validated(query, mode);
  const rows = await sqlitePrisma.frame.findMany({
    where: {
      tenantKey,
      ...(filter?.inStock === true ? { stock: { gt: 0 } } : {}),
      AND: frameWords(text, mode),
    },
    include: { brand: { select: { name: true } } },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: limitOf(limit),
  });
  return rows.map((f) => ({ id: f.id, code: f.code, name: f.name, brand: f.brand.name, reference: f.reference, price: f.price, currency: f.currency, stock: f.stock }));
}

export async function searchAccessories(query: string = "", limit?: number, by?: SearchBy, filter: { inStock?: boolean } = {}): Promise<ProductHit[]> {
  const tenantKey = await currentTenantKey();
  const mode = searchBy(by);
  const text = validated(query, mode);
  const rows = await sqlitePrisma.accessory.findMany({
    where: {
      tenantKey,
      ...(filter?.inStock === true ? { stock: { gt: 0 } } : {}),
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

/** A frame or an accessory found for a supplier order. */
export interface SupplierProductHit {
  kind: "frame" | "accessory";
  id: string;
  name: string;
  /** The frame's brand; null for an accessory. */
  brand: string | null;
  code: string | null;
  reference: string | null;
  stock: number;
}

/** How many products the search for a supplier order shows. */
export const SUPPLIER_PRODUCTS_PAGE = 60;

/**
 * The frames AND accessories a supplier order can be made for: those that have no line waiting in a supplier order (none with used = false). By model or by code, like
 * the other searches. filter.categoryId narrows to the frames of that category (accessories have none, so they are left out); filter.accessoriesOnly lists only accessories.
 * Newest names first is not needed: the result is in the order of the names. `more` says there were more than the page.
 */
export async function searchSupplierProducts(
  query: string = "",
  by?: SearchBy,
  filter: { categoryId?: number | null; accessoriesOnly?: boolean } = {},
): Promise<{ products: SupplierProductHit[]; more: boolean }> {
  const tenantKey = await currentTenantKey();
  const mode = searchBy(by);
  const text = validated(query, mode);
  const categoryId = typeof filter?.categoryId === "number" && Number.isInteger(filter.categoryId) ? filter.categoryId : undefined;
  const accessoriesOnly = filter?.accessoriesOnly === true;
  const hits: SupplierProductHit[] = [];

  if (!accessoriesOnly) {
    const frames = await sqlitePrisma.frame.findMany({
      where: { tenantKey, ...(categoryId !== undefined ? { categoryId } : {}), supplierOrderItems: { none: { used: false } }, AND: frameWords(text, mode) },
      include: { brand: { select: { name: true } } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: SUPPLIER_PRODUCTS_PAGE + 1,
    });
    for (const f of frames) hits.push({ kind: "frame", id: f.id, name: f.name, brand: f.brand.name, code: f.code, reference: f.reference, stock: f.stock });
  }
  if (categoryId === undefined) {
    const accessories = await sqlitePrisma.accessory.findMany({
      where: {
        tenantKey,
        supplierOrderItems: { none: { used: false } },
        AND: words(text).map((w) => ({
          OR: [
            ...(mode !== "code" ? [{ name: { contains: w } }, { description: { contains: w } }] : []),
            ...(mode !== "model" ? codeVariants(w).map((c) => ({ code: { contains: c } })) : []),
          ],
        })),
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: SUPPLIER_PRODUCTS_PAGE + 1,
    });
    for (const a of accessories) hits.push({ kind: "accessory", id: a.id, name: a.name, brand: null, code: a.code, reference: null, stock: a.stock });
  }
  hits.sort((x, y) => x.name.localeCompare(y.name) || x.id.localeCompare(y.id));
  return { products: hits.slice(0, SUPPLIER_PRODUCTS_PAGE), more: hits.length > SUPPLIER_PRODUCTS_PAGE };
}
