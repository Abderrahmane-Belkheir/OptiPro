import { prisma } from '../lib/prismaClient.js';

export async function getSiteInfo(host) {
  return {
  name: "Maison clair",
      social: [
    "",
    "",
  ],
      contact: {
    address: "231 hai el badr",
        phone: "0553702233",
        email: "belkheirabdou32@gmail.com",
  },
};
  const tenant = await prisma.tenant.findUnique({ where: { host } });



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
