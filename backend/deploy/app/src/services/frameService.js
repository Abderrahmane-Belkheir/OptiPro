import { prisma } from '../lib/prismaClient.js';

export async function getFrames({ host, brandId, categoryId }) {
  const rows = await prisma.frame.findMany({
    where: {
      brandId: Number(brandId),
      categoryId: Number(categoryId),
      tenant: { host },
    },
    select: {
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
    },
  });

  return rows.map(({ brand, category, stock, ...frame }) => ({
    ...frame,
    brand: brand.name,
    category: category.name,
    inStock: stock > 0,
  }));
}
