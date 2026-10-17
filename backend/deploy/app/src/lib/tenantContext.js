import { Prisma } from '../generated/prisma/index.js';
import { prisma } from './prismaClient.js';

/**
 * Runs `fn(tx)` in a transaction whose Postgres setting `app.tenant_key` is `tenantKey` — the
 * value the row-level security policies in prisma/permissions.sql compare each row's tenant_key against.
 * The setting is transaction-local (set_config's third argument), so it's gone at commit and can't
 * leak to the next request that reuses the same pooled connection.
 *
 * Queries on tenant-owned tables (brands, frames, accessories, customers) must go through `tx`: the same query
 * on the plain `prisma` client has no tenant set, and Postgres returns no rows for it.
 */
export function withTenant(tenantKey, fn) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.tenant_key', ${tenantKey}, true)`;
    return fn(tx);
  }, TRANSACTION_LIMITS);
}

// Prisma gives an interactive transaction 2 s to get a connection (maxWait) and 5 s to finish
// (timeout), then fails the request with P2028 — a 500 for the user. Neon's pooler can take longer
// than that to hand out a connection (after the database has been idle, or under a burst), so the
// limits are raised; they are only ceilings, a normal request still takes milliseconds.
// Override with DB_TX_MAX_WAIT_MS / DB_TX_TIMEOUT_MS if they ever need tuning.
const TRANSACTION_LIMITS = {
  maxWait: Number(process.env.DB_TX_MAX_WAIT_MS) || 10_000,
  timeout: Number(process.env.DB_TX_TIMEOUT_MS) || 20_000,
};

/** Public routes only know the request's host; this finds the tenant key to set the context from. */
export async function resolveTenantKeyByHost(host) {
  const tenant = await prisma.tenant.findUnique({ where: { host }, select: { key: true } });
  return tenant?.key ?? null;
}

/**
 * Isolation now lives in Postgres, but only once prisma/permissions.sql has been run and only for a role
 * that RLS applies to — neither is something this process can enforce, so check and shout at startup.
 */
export async function warnIfRlsDisabled() {
  const tenantOwned = Prisma.dmmf.datamodel.models
    .filter((model) => model.fields.some((field) => field.name === 'tenantKey'))
    .map((model) => model.dbName ?? model.name);

  try {
    const [role] = await prisma.$queryRaw`
      SELECT current_user::text AS name, (rolsuper OR rolbypassrls) AS bypasses
      FROM pg_roles WHERE rolname = current_user`;
    const tables = await prisma.$queryRaw`
      SELECT c.relname::text AS name, c.relrowsecurity AS rls, pg_get_userbyid(c.relowner)::text AS owner
      FROM pg_class c
      WHERE c.relnamespace = 'public'::regnamespace AND c.relname::text = ANY(${tenantOwned}::text[])`;

    const withoutRls = tables.filter((table) => !table.rls).map((table) => table.name);
    if (withoutRls.length) {
      console.warn(
        `WARNING: row-level security is NOT enabled on: ${withoutRls.join(', ')} — tenant isolation ` +
          'is not enforced by the database. Run prisma/permissions.sql as the table owner.',
      );
    }
    if (role?.bypasses || tables.some((table) => table.owner === role?.name)) {
      console.warn(
        `WARNING: the database role "${role?.name}" owns these tables or bypasses RLS, so the ` +
          'policies do not apply to it. Connect as a separate, non-owner role.',
      );
    }
  } catch (err) {
    console.warn('Could not verify row-level security status:', err.message);
  }
}
