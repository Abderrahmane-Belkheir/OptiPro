import { prisma } from '../lib/prismaClient.js';
import { resolveTenantKeyByHost, withTenant } from '../lib/tenantContext.js';

export async function getCatalog(host) {
  const tenantKey = await resolveTenantKeyByHost(host);

  const [categoryRows, brands] = await Promise.all([
    prisma.category.findMany({ select: { id: true, name: true, imageUrl: true } }),
    // Only this tenant's brands: filtered here, and row-level security (withTenant) checks it again in
    // the database. The filter is the one that always applies; the policies only when the role is subject to RLS.
    tenantKey
      ? withTenant(tenantKey, (tx) => tx.brand.findMany({ where: { tenantKey }, select: { id: true, name: true } }))
      : [],
  ]);

  // Prisma's `select` can't rename a field, so `imageUrl` (the client's field name — `@map` only
  // renames the DB column) is mapped to `url` here to match what the frontend expects.
  const categories = categoryRows.map(({ id, name, imageUrl }) => ({ id, name, url: imageUrl }));

  return { categories, brands };
}
