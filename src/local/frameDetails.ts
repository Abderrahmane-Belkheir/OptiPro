import { decodeStringArray, sqlitePrisma } from "../lib/sqliteClient";
import { currentTenantKey } from "./context";
import { localPhotoFiles, photoAddress } from "./photoService";
import { STATIC_CATEGORIES } from "./staticCategories";

/**
 * Everything the frame's details page shows: the frame itself with its brand and category names and its photos, and how much of it was sold.
 * Real data only. "Sold" counts the units on order lines of this frame, on orders that are not cancelled (an order that was placed counts,
 * whether or not it was delivered or paid). "Last 30 days" is a rolling window by the order's date: the 30 days up to now.
 */

export const SOLD_WINDOW_DAYS = 30;

export interface FrameDetails {
  id: string;
  code: string | null;
  name: string;
  brandId: string;
  brandName: string;
  categoryId: number;
  categoryName: string;
  reference: string | null;
  shape: string | null;
  colors: string[];
  eyeSize: number | null;
  bridge: number | null;
  templeLength: number | null;
  price: number | null;
  currency: string | null;
  costPrice: number | null;
  stock: number;
  photos: { id: string; url: string; synced: boolean }[];
  sold: {
    /** Units sold, ever. */
    total: number;
    /** Units sold on orders dated within the last 30 days. */
    last30Days: number;
    /** The date of the most recent order that has this frame, or null when it was never sold. */
    lastSoldAt: string | null;
  };
}

/** The frame with this id for the details page, or null when there is none. */
export async function frameDetails(id: string): Promise<FrameDetails | null> {
  const tenantKey = await currentTenantKey();
  const row = await sqlitePrisma.frame.findFirst({
    where: { id, tenantKey },
    include: { brand: { select: { name: true } }, productImages: { select: { id: true, synced: true }, orderBy: { id: "asc" } } },
  });
  if (!row) return null;

  const since = new Date(Date.now() - SOLD_WINDOW_DAYS * 86400000);
  const [lines, files] = await Promise.all([
    sqlitePrisma.orderItem.findMany({
      where: { tenantKey, frameId: id, order: { is: { status: { not: "cancelled" } } } },
      select: { quantity: true, order: { select: { orderedAt: true } } },
    }),
    row.productImages.length > 0 ? localPhotoFiles() : Promise.resolve(new Map<string, string>()),
  ]);
  let total = 0;
  let last30Days = 0;
  let lastSold: Date | null = null;
  for (const line of lines) {
    total += line.quantity;
    if (line.order.orderedAt >= since) last30Days += line.quantity;
    if (lastSold === null || line.order.orderedAt > lastSold) lastSold = line.order.orderedAt;
  }

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    brandId: row.brandId,
    brandName: row.brand.name,
    categoryId: row.categoryId,
    categoryName: STATIC_CATEGORIES.find((c) => c.id === row.categoryId)?.name ?? "",
    reference: row.reference,
    shape: row.shape,
    colors: decodeStringArray(row.colors),
    eyeSize: row.eyeSize,
    bridge: row.bridge,
    templeLength: row.templeLength,
    price: row.price,
    currency: row.currency,
    costPrice: row.costPrice,
    stock: row.stock,
    photos: row.productImages.map((p) => ({ id: p.id, url: photoAddress(p.id, files), synced: Boolean(p.synced) })),
    sold: { total, last30Days, lastSoldAt: lastSold ? lastSold.toISOString() : null },
  };
}
