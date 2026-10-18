import { ConfigError } from "../config";
import { remoteConnection, RemoteUnreachableError } from "../db/remote";
import { Prisma } from "../generated/sqlite-client";
import { sqlitePrisma } from "../lib/sqliteClient";

let resolved: string | undefined;

/** How long start-up waits for the database before it carries on with the shop it already knows. */
const CHECK_TIMEOUT_MS = 4000;

type Shop = { key: string; host: string; name: string };

/** The shops the database holds, or `null` when it can't be reached (quickly enough). */
async function fetchShops(timeoutMs: number): Promise<Shop[] | null> {
  const request = remoteConnection.fetchTenants();
  request.catch(() => {}); // if the timer wins, the late answer or failure is of no interest
  try {
    return await Promise.race([
      request,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  } catch (err) {
    if (err instanceof RemoteUnreachableError) return null;
    throw err;
  }
}

/**
 * The local `tenants` row for a shop. `host` is unique locally, and a shop learned from its login's
 * policies has no host, so one is made from the key: no two shops can ever collide on it.
 */
function localRow(shop: Shop): { key: string; host: string; name: string } {
  return { key: shop.key, host: shop.host || `local:${shop.key}`, name: shop.name || shop.key };
}

function exactlyOne(shops: Shop[]): Shop {
  if (shops.length !== 1) {
    throw new ConfigError(
      shops.length === 0
        ? "The database has no shop in its tenants table, so there is nothing to work with."
        : `The database holds ${shops.length} shops (${shops.map((t) => t.key).join(", ")}); this app works with a database that has exactly one.`,
    );
  }
  return shops[0];
}

/**
 * Moves everything in the local database to another shop key. This happens when the local file was
 * made for a different shop than the one the database URL points at (for example it was created
 * before the URL changed): the rows keep their data, take the new key, and are marked "not synced"
 * so the next pass sends them to the shop they now belong to. Brand ids from the old shop mean
 * nothing in the new one, so they are forgotten and handed out again.
 */
async function moveLocalDataTo(shop: Shop, oldKey: string): Promise<void> {
  const owned = Prisma.dmmf.datamodel.models.filter((m) => m.fields.some((f) => f.name === "tenantKey"));
  await sqlitePrisma.$transaction(async (tx) => {
    await tx.tenant.upsert({ where: { key: shop.key }, create: localRow(shop), update: {} });
    for (const model of owned) {
      const table = model.dbName ?? model.name;
      const column = model.fields.find((f) => f.name === "tenantKey")!.dbName ?? "tenantKey";
      const sets = [`"${column}" = ?`];
      if (model.fields.some((f) => f.name === "synced")) sets.push(`"synced" = 0`);
      if (model.fields.some((f) => f.name === "remoteId")) sets.push(`"remote_id" = NULL`);
      await tx.$executeRawUnsafe(`UPDATE "${table}" SET ${sets.join(", ")} WHERE "${column}" = ?`, shop.key, oldKey);
    }
    await tx.tenant.deleteMany({ where: { key: oldKey } });
  });
}

/**
 * The shop every row belongs to. The config holds only the database URL, so the shop is learned
 * from the database itself: its `tenants` table must hold exactly one shop. The answer is saved in
 * the local database (every tenant-owned table has a foreign key to its `tenants` row), so the app
 * also starts and works offline. Resolved once per run.
 *
 * With a saved shop and a reachable database, the two are compared: if the database now belongs to
 * another shop, the local data moves to it (see moveLocalDataTo). If the database can't be reached,
 * the saved shop is used as is.
 *
 * Throws ConfigError when the database holds no shop or several, and RemoteUnreachableError when
 * the very first run has no connection yet.
 */
export async function currentTenantKey(): Promise<string> {
  if (resolved) return resolved;

  const known = await sqlitePrisma.tenant.findMany({ select: { key: true } });

  if (known.length === 1) {
    const shops = await fetchShops(CHECK_TIMEOUT_MS);
    if (shops === null) return (resolved = known[0].key); // offline: carry on with the saved shop
    const shop = exactlyOne(shops);
    if (shop.key !== known[0].key) await moveLocalDataTo(shop, known[0].key);
    return (resolved = shop.key);
  }

  let shops: Shop[];
  try {
    shops = await remoteConnection.fetchTenants();
  } catch (err) {
    if (err instanceof RemoteUnreachableError) {
      throw new RemoteUnreachableError(`${err.message} The first start needs a connection to learn which shop this database belongs to.`);
    }
    throw err;
  }
  const shop = exactlyOne(shops);
  await sqlitePrisma.tenant.upsert({
    where: { key: shop.key },
    create: localRow(shop),
    update: {},
  });
  return (resolved = shop.key);
}
