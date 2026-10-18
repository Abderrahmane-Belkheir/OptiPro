import { toImageCodes } from '../lib/imageCodes.js';
import { resolveTenantKeyByHost, withTenant } from '../lib/tenantContext.js';

// What an accessory is read with. `productImages` is the join with the product_images table (through its
// accessory_id), keeping only this tenant's rows and only each photo's id.
const accessorySelect = (tenantKey) => ({
  id: true,
  name: true,
  description: true,
  price: true,
  currency: true,
  images: true,
  stock: true,
  productImages: { where: { tenantKey }, orderBy: { id: 'asc' }, select: { id: true } },
});

// Every query filters on the tenant's key itself, and withTenant (lib/tenantContext.js) has Postgres
// row-level security check the same thing again. The explicit filter is the one that always applies: the
// policies only apply to a role that is subject to RLS (not one with BYPASSRLS, not the table owner).
// `images` goes out as photo CODES only (see lib/imageCodes.js); the website builds the address.
// `imageIds` lists the ids of the accessory's photos (product_images), for GET /api/images/:id.
const reshapeAccessory = ({ stock, images, productImages, ...accessory }) => ({
  ...accessory,
  images: toImageCodes(images),
  imageIds: productImages.map((image) => image.id),
  inStock: stock > 0,
});

export async function getAccessories(host) {
  const tenantKey = await resolveTenantKeyByHost(host);
  if (!tenantKey) return [];

  const rows = await withTenant(tenantKey, (tx) =>
    tx.accessory.findMany({ relationLoadStrategy: 'join', where: { tenantKey }, select: accessorySelect(tenantKey) }),
  );
  return rows.map(reshapeAccessory);
}

export async function getAccessoryById(host, id) {
  const tenantKey = await resolveTenantKeyByHost(host);
  if (!tenantKey) return null;

  const row = await withTenant(tenantKey, (tx) =>
    tx.accessory.findFirst({ relationLoadStrategy: 'join', where: { id, tenantKey }, select: accessorySelect(tenantKey) }),
  );
  return row ? reshapeAccessory(row) : null;
}
