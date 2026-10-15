import { prisma } from '../lib/prismaClient.js';

export async function getCatalog(host) {
  const [categoryRows, brands] = await Promise.all([
    prisma.category.findMany({ select: { id: true, name: true, imageUrl: true } }),
    prisma.brand.findMany({ where: { tenant: { host } }, select: { id: true, name: true } }),
  ]);

  // Prisma's `select` can't rename a field, so `imageUrl` (the client's field name — `@map` only
  // renames the DB column) is mapped to `url` here to match what the frontend expects.
  const categories = categoryRows.map(({ id, name, imageUrl }) => ({ id, name, url: imageUrl }));

  return { categories, brands };
}
