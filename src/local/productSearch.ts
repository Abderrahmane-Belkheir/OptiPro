import { sqlitePrisma } from "../lib/sqliteClient";
import { currentTenantKey } from "./context";

/**
 * Searching the shop's frames and accessories by what a person types (a name, a code, a maker's reference, a brand). Real rows from the local
 * database, nothing else. Every word typed has to match somewhere (name, code, reference or brand for a frame; name, code or description for an
 * accessory), in any case. Nothing typed gives the first ones in name order, so a picker has something to show at once.
 */

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

const words = (query: unknown): string[] => (typeof query === "string" ? query.trim().split(/\s+/).filter(Boolean).slice(0, 6) : []);
const limitOf = (limit: unknown): number => (typeof limit === "number" && Number.isInteger(limit) && limit > 0 ? Math.min(limit, SEARCH_LIMIT_MAX) : SEARCH_LIMIT_DEFAULT);

export async function searchFrames(query: string = "", limit?: number): Promise<ProductHit[]> {
  const tenantKey = await currentTenantKey();
  const rows = await sqlitePrisma.frame.findMany({
    where: {
      tenantKey,
      AND: words(query).map((w) => ({ OR: [{ name: { contains: w } }, { code: { contains: w } }, { reference: { contains: w } }, { brand: { is: { name: { contains: w } } } }] })),
    },
    include: { brand: { select: { name: true } } },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: limitOf(limit),
  });
  return rows.map((f) => ({ id: f.id, code: f.code, name: f.name, brand: f.brand.name, reference: f.reference, price: f.price, currency: f.currency, stock: f.stock }));
}

export async function searchAccessories(query: string = "", limit?: number): Promise<ProductHit[]> {
  const tenantKey = await currentTenantKey();
  const rows = await sqlitePrisma.accessory.findMany({
    where: {
      tenantKey,
      AND: words(query).map((w) => ({ OR: [{ name: { contains: w } }, { code: { contains: w } }, { description: { contains: w } }] })),
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: limitOf(limit),
  });
  return rows.map((a) => ({ id: a.id, code: a.code, name: a.name, brand: null, reference: null, price: a.price, currency: a.currency, stock: a.stock }));
}
