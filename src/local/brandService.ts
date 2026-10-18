import { sqlitePrisma } from "../lib/sqliteClient";
import type { Brand, NewBrand } from "../services/types";
import { remoteConnection } from "../db/remote";
import { currentTenantKey } from "./context";
import { tryPush } from "./sync";
import { pushRow, registerPusher } from "./syncPush";
import { LocalDbError, translateError } from "./errors";

/**
 * Sends a brand to the remote database and marks it synced. A brand that already has a remoteId is sent
 * with it, which updates that brand there; one without was never sent, so it is inserted and the
 * id the remote database picks is stored.
 */
export async function pushBrand(id: number, tenantKey: string): Promise<void> {
  const brand = await sqlitePrisma.brand.findFirstOrThrow({ where: { id, tenantKey } });
  await tryPush(`brand "${brand.name}"`, async () => {
    const saved = await remoteConnection.saveBrand(
      tenantKey,
      brand.remoteId === null ? { name: brand.name } : { id: brand.remoteId, name: brand.name },
    );
    await sqlitePrisma.brand.update({ where: { id }, data: { remoteId: saved.id, synced: true } });
  });
}

export const localBrandService = {
  async list(): Promise<Brand[]> {
    const tenantKey = await currentTenantKey();
    return sqlitePrisma.brand.findMany({ where: { tenantKey }, orderBy: { name: "asc" } });
  },

  async get(id: number): Promise<Brand | null> {
    const tenantKey = await currentTenantKey();
    return sqlitePrisma.brand.findFirst({ where: { id, tenantKey } });
  },

  async insert(brand: NewBrand): Promise<Brand> {
    const tenantKey = await currentTenantKey();
    let created: Brand;
    try {
      created = await sqlitePrisma.brand.create({ data: { name: brand.name, tenantKey } });
    } catch (err) {
      translateError(err, "Insert brand");
    }

    // The remote database assigns its own id (brands.id is a serial there as it is here), so the two ids
    // differ; the remote database's is kept in remoteId, and that is what frames are sent with.
    await pushRow("brands", created.id);
    return sqlitePrisma.brand.findFirstOrThrow({ where: { id: created.id, tenantKey } });
  },

  /** Inserts all the brands or none of them; each is then pushed on its own, since the database picks every brand's id. */
  async insertMany(brands: NewBrand[]): Promise<Brand[]> {
    const tenantKey = await currentTenantKey();
    let created: Brand[];
    try {
      created = await sqlitePrisma.$transaction(brands.map((b) => sqlitePrisma.brand.create({ data: { name: b.name, tenantKey } })));
    } catch (err) {
      translateError(err, "Insert brands");
    }
    for (const brand of created) await pushRow("brands", brand.id);
    return Promise.all(created.map((brand) => sqlitePrisma.brand.findFirstOrThrow({ where: { id: brand.id, tenantKey } })));
  },

  async update(id: number, changes: Partial<NewBrand>): Promise<Brand> {
    const tenantKey = await currentTenantKey();
    try {
      const { count } = await sqlitePrisma.brand.updateMany({ where: { id, tenantKey }, data: { ...changes, synced: false } });
      if (!count) throw new LocalDbError(`Update brand: no brand ${id}.`, "not-found");
    } catch (err) {
      translateError(err, "Update brand");
    }
    await pushRow("brands", id);
    return sqlitePrisma.brand.findFirstOrThrow({ where: { id, tenantKey } });
  },

  async remove(id: number): Promise<void> {
    const tenantKey = await currentTenantKey();
    try {
      const { count } = await sqlitePrisma.brand.deleteMany({ where: { id, tenantKey } });
      if (!count) throw new LocalDbError(`Delete brand: no brand ${id}.`, "not-found");
    } catch (err) {
      translateError(err, "Delete brand");
    }
  },
};

// Sent one by one: the remote database gives every brand its own id.
registerPusher("brands", async (ids, tenantKey) => {
  for (const id of ids) await pushBrand(id as number, tenantKey);
});
