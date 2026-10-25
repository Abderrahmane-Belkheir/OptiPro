import { toImageCodes } from '../lib/imageCodes.js';
import { resolveTenantKeyByHost, withTenant } from '../lib/tenantContext.js';

// What a frame is read with. `productImages` is the join with the product_images table (through its
// frame_id), keeping only this tenant's rows and only each photo's id.
// The id is internal and never goes out: a frame is known by its code (unique per shop).
const frameSelect = (tenantKey) => ({
  code: true,
  name: true,
  price: true,
  currency: true,
  images: true,
  shape: true,
  gender: true,
  colors: true,
  stock: true,
  brand: { select: { name: true } },
  category: { select: { name: true } },
  productImages: { where: { tenantKey }, orderBy: { id: 'asc' }, select: { id: true } },
});

// `images` goes out as photo CODES only (see lib/imageCodes.js); the website builds the address.
// `imageIds` lists the ids of the frame's photos (product_images), for GET /api/images/:id.
function reshapeFrame({ brand, category, stock, images, productImages, ...frame }) {
  return {
    ...frame,
    images: toImageCodes(images),
    imageIds: productImages.map((image) => image.id),
    brand: brand.name,
    category: category.name,
    inStock: stock > 0,
  };
}

// Every query filters on the tenant's key itself (a frame of another tenant is never returned, by id or
// otherwise), and withTenant (lib/tenantContext.js) has Postgres row-level security check the same thing
// again. The explicit filter is the one that always applies: the policies only apply to a role that is
// subject to RLS (not one with BYPASSRLS, not the table owner).
export async function getFrames({ host, brandId, categoryId }) {
  const tenantKey = await resolveTenantKeyByHost(host);
  if (!tenantKey) return [];

  const rows = await withTenant(tenantKey, (tx) =>
    tx.frame.findMany({
      relationLoadStrategy: 'join',
      where: { tenantKey, code: { not: null }, brandId: String(brandId), categoryId: Number(categoryId) }, // a frame without a code cannot be addressed: it is not offered
      select: frameSelect(tenantKey),
    }),
  );

  return rows.map(reshapeFrame);
}

// The code is looked up in lowercase (a typed or scanned code may be in any case), within the shop of the host: two shops can have the same code.
export async function getFrameByCode(host, code) {
  const tenantKey = await resolveTenantKeyByHost(host);
  if (!tenantKey) return null;

  const row = await withTenant(tenantKey, (tx) =>
    tx.frame.findFirst({ relationLoadStrategy: 'join', where: { tenantKey, code: String(code).trim().toLowerCase() }, select: frameSelect(tenantKey) }),
  );
  return row ? reshapeFrame(row) : null;
}
