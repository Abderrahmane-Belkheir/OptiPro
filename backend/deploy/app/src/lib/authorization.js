import { prisma } from './prismaClient.js';

/**
 * The Authorization header value is the tenant's key. Resolves to that key if a tenant with it
 * exists, or null if not — callers must reject on null, and use the returned key (never the
 * request's host) to scope rows. Accepts the bare key or "Bearer <key>".
 */
export async function authorize(authorization) {
  const key = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!key) return null;

  const tenant = await prisma.tenant.findUnique({ where: { key }, select: { key: true } });
  return tenant?.key ?? null;
}
