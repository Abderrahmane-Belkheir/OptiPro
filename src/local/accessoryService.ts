import { decodeStringArray, encodeStringArray, sqlitePrisma } from "../lib/sqliteClient";
import type { Accessory, NewAccessory } from "../services/types";
import { remoteConnection } from "../db/remote";
import { currentTenantKey } from "./context";
import { tryPush } from "./sync";
import { pushRow, registerPusher } from "./syncPush";
import { LocalDbError, translateError } from "./errors";

type AccessoryRow = NonNullable<Awaited<ReturnType<typeof sqlitePrisma.accessory.findFirst>>>;

function toAccessory(row: AccessoryRow): Accessory {
  return { ...row, images: decodeStringArray(row.images) };
}

function toColumns(changes: Partial<Omit<NewAccessory, "id">>) {
  const { images, ...rest } = changes;
  return { ...rest, ...(images !== undefined && { images: encodeStringArray(images) }) };
}

/**
 * Sends just-saved (inserted or updated) accessories to the remote database in one request and marks them synced if it
 * accepted them. Returns the rows as they now stand.
 */
export async function pushRows(ids: string[], tenantKey: string): Promise<Accessory[]> {
  const rows = await sqlitePrisma.accessory.findMany({ where: { id: { in: ids }, tenantKey } });
  await tryPush(`${rows.length} accessory(ies)`, async () => {
    await remoteConnection.upsertMany(
      tenantKey,
      "accessories",
      rows.map(({ id, name, description, price, currency, images, stock, costPrice }) => ({
        id, name, description, price, currency, images: decodeStringArray(images), stock, costPrice,
      })),
    );
    await sqlitePrisma.accessory.updateMany({ where: { id: { in: ids }, tenantKey }, data: { synced: true } });
  });
  const fresh = await sqlitePrisma.accessory.findMany({ where: { id: { in: ids }, tenantKey } });
  return ids.map((id) => toAccessory(fresh.find((r) => r.id === id)!));
}

export const localAccessoryService = {
  async list(): Promise<Accessory[]> {
    const tenantKey = await currentTenantKey();
    const rows = await sqlitePrisma.accessory.findMany({ where: { tenantKey }, orderBy: { name: "asc" } });
    return rows.map(toAccessory);
  },

  async get(id: string): Promise<Accessory | null> {
    const tenantKey = await currentTenantKey();
    const row = await sqlitePrisma.accessory.findFirst({ where: { id, tenantKey } });
    return row ? toAccessory(row) : null;
  },

  async insert(accessory: NewAccessory): Promise<Accessory> {
    const tenantKey = await currentTenantKey();
    try {
      const { id, ...rest } = accessory;
      await sqlitePrisma.accessory.create({ data: { id, ...toColumns(rest), tenantKey } as never });
    } catch (err) {
      translateError(err, "Insert accessory");
    }
    await pushRow("accessories", accessory.id);
    return (await localAccessoryService.get(accessory.id))!;
  },

  /** Inserts all the accessories or none of them. */
  async insertMany(accessories: NewAccessory[]): Promise<Accessory[]> {
    const tenantKey = await currentTenantKey();
    try {
      await sqlitePrisma.$transaction(
        accessories.map(({ id, ...rest }) => sqlitePrisma.accessory.create({ data: { id, ...toColumns(rest), tenantKey } as never })),
      );
    } catch (err) {
      translateError(err, "Insert accessories");
    }
    return pushRows(accessories.map((a) => a.id), tenantKey);
  },

  async update(id: string, changes: Partial<Omit<NewAccessory, "id">>): Promise<Accessory> {
    const tenantKey = await currentTenantKey();
    try {
      const { count } = await sqlitePrisma.accessory.updateMany({ where: { id, tenantKey }, data: { ...toColumns(changes), synced: false } });
      if (!count) throw new LocalDbError(`Update accessory: no accessory "${id}".`, "not-found");
    } catch (err) {
      translateError(err, "Update accessory");
    }
    await pushRow("accessories", id);
    return (await localAccessoryService.get(id))!;
  },

  async remove(id: string): Promise<void> {
    const tenantKey = await currentTenantKey();
    try {
      const { count } = await sqlitePrisma.accessory.deleteMany({ where: { id, tenantKey } });
      if (!count) throw new LocalDbError(`Delete accessory: no accessory "${id}".`, "not-found");
    } catch (err) {
      translateError(err, "Delete accessory");
    }
  },
};

registerPusher("accessories", (ids, tenantKey) => pushRows(ids as string[], tenantKey));
