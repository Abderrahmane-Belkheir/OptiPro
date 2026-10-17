import { resolveTenantKeyByHost, withTenant } from '../lib/tenantContext.js';

const FRAME_SELECT = {
  id: true,
  name: true,
  price: true,
  currency: true,
  images: true,
  shape: true,
  colors: true,
  stock: true,
  brand: { select: { name: true } },
  category: { select: { name: true } },
};

function reshapeFrame({ brand, category, stock, ...frame }) {
  return { ...frame, brand: brand.name, category: category.name, inStock: stock > 0 };
}

// Which tenant's frames are visible is decided by Postgres row-level security (see
// lib/tenantContext.js), not by a filter in these queries — a frame of another tenant simply
// isn't there to be found, by id or otherwise.
export async function getFrames({ host, brandId, categoryId }) {
  const tenantKey = await resolveTenantKeyByHost(host);
  if (!tenantKey) return [];

  const rows = await withTenant(tenantKey, (tx) =>
    tx.frame.findMany({
      where: { brandId: Number(brandId), categoryId: Number(categoryId) },
      select: FRAME_SELECT,
    }),
  );

  return rows.map(reshapeFrame);
}

export async function getFrameById(host, id) {
  const tenantKey = await resolveTenantKeyByHost(host);
  if (!tenantKey) return null;

  const row = await withTenant(tenantKey, (tx) =>
    tx.frame.findUnique({ where: { id }, select: FRAME_SELECT }),
  );
  return row ? reshapeFrame(row) : null;
}
