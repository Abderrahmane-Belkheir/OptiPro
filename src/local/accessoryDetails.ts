import { sqlitePrisma } from "../lib/sqliteClient";
import { currentTenantKey } from "./context";
import { localPhotoFiles, photoAddress } from "./photoService";
import { SOLD_WINDOW_DAYS } from "./frameDetails";

/**
 * Everything the accessory's details page shows: the accessory itself with its photos, and how much of it was sold. Real data only. "Sold"
 * counts the units on order lines of this accessory, on orders that are not cancelled; "last 30 days" is a rolling window by the order's date.
 * (Same rules as frameDetails.ts.)
 */

export interface AccessoryDetails {
  id: string;
  code: string | null;
  name: string;
  description: string;
  price: number | null;
  currency: string | null;
  costPrice: number | null;
  stock: number;
  photos: { id: string; url: string; synced: boolean }[];
  sold: {
    total: number;
    last30Days: number;
    lastSoldAt: string | null;
  };
}

/** The accessory with this id for the details page, or null when there is none. */
export async function accessoryDetails(id: string): Promise<AccessoryDetails | null> {
  const tenantKey = await currentTenantKey();
  const row = await sqlitePrisma.accessory.findFirst({
    where: { id, tenantKey },
    include: { productImages: { select: { id: true, synced: true }, orderBy: { id: "asc" } } },
  });
  if (!row) return null;

  const since = new Date(Date.now() - SOLD_WINDOW_DAYS * 86400000);
  const [lines, files] = await Promise.all([
    sqlitePrisma.orderItem.findMany({
      where: { tenantKey, accessoryId: id, order: { is: { status: { not: "cancelled" } } } },
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
    description: row.description,
    price: row.price,
    currency: row.currency,
    costPrice: row.costPrice,
    stock: row.stock,
    photos: row.productImages.map((p) => ({ id: p.id, url: photoAddress(p.id, files), synced: Boolean(p.synced) })),
    sold: { total, last30Days, lastSoldAt: lastSold ? lastSold.toISOString() : null },
  };
}
