import { requireTenantKey } from "../config";
import { Prisma } from "../generated/sqlite-client";
import { sqlitePrisma } from "../lib/sqliteClient";

let resolved: string | undefined;

/**
 * The local `tenants` row for a shop. `host` is unique locally and the shop's real host is not known on this computer,
 * so one is made from the key: no two shops can ever collide on it.
 */
function localRow(key: string): { key: string; host: string; name: string } {
  return { key, host: `local:${key}`, name: key };
}

/**
 * Moves everything in the local database to another shop key. This happens when the local file was
 * made for a different shop than the one tenant.key now names: the rows keep their data, take the new
 * key, and are marked "not synced" so the next pass sends them to the shop they now belong to.
 */
async function moveLocalDataTo(key: string, oldKey: string): Promise<void> {
  const owned = Prisma.dmmf.datamodel.models.filter((m) => m.fields.some((f) => f.name === "tenantKey"));
  await sqlitePrisma.$transaction(async (tx) => {
    await tx.tenant.upsert({ where: { key }, create: localRow(key), update: {} });
    for (const model of owned) {
      const table = model.dbName ?? model.name;
      const column = model.fields.find((f) => f.name === "tenantKey")!.dbName ?? "tenantKey";
      const sets = [`"${column}" = ?`];
      if (model.fields.some((f) => f.name === "synced")) sets.push(`"synced" = 0`);
      await tx.$executeRawUnsafe(`UPDATE "${table}" SET ${sets.join(", ")} WHERE "${column}" = ?`, key, oldKey);
    }
    await tx.tenant.deleteMany({ where: { key: oldKey } });
  });
}

/**
 * The shop every row belongs to: the `tenant.key` of config.properties. It is saved in the local database (every
 * tenant-owned table has a foreign key to its `tenants` row), so the app works offline. Resolved once per run.
 *
 * If the local database holds a different shop than the key names, the local data moves to the key's shop
 * (see moveLocalDataTo).
 *
 * Throws ConfigError when config.properties has no tenant.key.
 */
export async function currentTenantKey(): Promise<string> {
  if (resolved) return resolved;
  const key = requireTenantKey();

  const known = await sqlitePrisma.tenant.findMany({ select: { key: true } });
  if (known.length === 1 && known[0].key !== key) await moveLocalDataTo(key, known[0].key);
  else await sqlitePrisma.tenant.upsert({ where: { key }, create: localRow(key), update: {} });
  return (resolved = key);
}
