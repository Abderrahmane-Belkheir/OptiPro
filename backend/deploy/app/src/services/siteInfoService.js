import { prisma } from '../lib/prismaClient.js';

export async function getSiteInfo(host) {

  const tenant = await prisma.tenant.findUnique({ where: { host } });
  if(!tenant) return null
  return {
    name: tenant.name,
    social: [
      ...(tenant.instagramUrl ? [{ label: 'Instagram', url: tenant.instagramUrl }] : []),
      ...(tenant.tiktokUrl ? [{ label: 'TikTok', url: tenant.tiktokUrl }] : []),
    ],
    contact: {
      address: tenant.address,
      phone: tenant.phone,
      email: tenant.email,
    },
  };
}
