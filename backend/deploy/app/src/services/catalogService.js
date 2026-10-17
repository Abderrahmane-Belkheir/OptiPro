import { prisma } from '../lib/prismaClient.js';
import { resolveTenantKeyByHost, withTenant } from '../lib/tenantContext.js';

export async function getCatalog(host) {
  const tenantKey = await resolveTenantKeyByHost(host);

  const [categoryRows, brands] = await Promise.all([
    prisma.category.findMany({ select: { id: true, name: true, imageUrl: true } }),
    // Which tenant's brands comes back is decided by Postgres row-level security, not a filter here.
    tenantKey
      ? withTenant(tenantKey, (tx) => tx.brand.findMany({ select: { id: true, name: true } }))
      : [],
  ]);

  // Prisma's `select` can't rename a field, so `imageUrl` (the client's field name — `@map` only
  // renames the DB column) is mapped to `url` here to match what the frontend expects.
  const categories = categoryRows.map(({ id, name, imageUrl }) => ({ id, name, url: imageUrl }));

  return { categories, brands };
}
