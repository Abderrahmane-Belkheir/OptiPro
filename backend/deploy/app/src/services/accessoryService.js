import { prisma } from '../lib/prismaClient.js';

export async function getAccessories(host) {
  const rows = await prisma.accessory.findMany({
    where: { tenant: { host } },
    select: {
      id: true,
      name: true,
      description: true,
      price: true,
      currency: true,
      imageUrl: true,
      stock: true,
    },
  });

  return rows.map(({ stock, ...accessory }) => ({ ...accessory, inStock: stock > 0 }));
}
