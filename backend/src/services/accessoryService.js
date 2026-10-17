import { resolveTenantKeyByHost, withTenant } from '../lib/tenantContext.js';

const ACCESSORY_SELECT = {
  id: true,
  name: true,
  description: true,
  price: true,
  currency: true,
  images: true,
  stock: true,
};

// Which tenant's accessories are visible is decided by Postgres row-level security (see
// lib/tenantContext.js), not by a filter in these queries.
export async function getAccessories(host) {
  const tenantKey = await resolveTenantKeyByHost(host);
  if (!tenantKey) return [];

  const rows = await withTenant(tenantKey, (tx) => tx.accessory.findMany({ select: ACCESSORY_SELECT }));
  return rows.map(({ stock, ...accessory }) => ({ ...accessory, inStock: stock > 0 }));
}

export async function getAccessoryById(host, id) {
  const tenantKey = await resolveTenantKeyByHost(host);
  if (!tenantKey) return null;

  const row = await withTenant(tenantKey, (tx) =>
    tx.accessory.findUnique({ where: { id }, select: ACCESSORY_SELECT }),
  );
  if (!row) return null;

  const { stock, ...accessory } = row;
  return { ...accessory, inStock: stock > 0 };
}
