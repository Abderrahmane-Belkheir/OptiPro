import { decodeStringArray, encodeStringArray, sqlitePrisma } from "../lib/sqliteClient";
import type { Frame, NewFrame } from "../services/types";
import { remoteConnection } from "../db/remote";
import { currentTenantKey } from "./context";
import { tryPush } from "./sync";
import { pushRow, registerPusher } from "./syncPush";
import { LocalDbError, translateError } from "./errors";

type FrameRow = NonNullable<Awaited<ReturnType<typeof sqlitePrisma.frame.findFirst>>>;

function toFrame(row: FrameRow): Frame {
  return { ...row, images: decodeStringArray(row.images), colors: decodeStringArray(row.colors) };
}

/** The columns of `changes` that were given, with the arrays JSON-encoded for SQLite. */
function toColumns(changes: Partial<Omit<NewFrame, "id">>) {
  const { images, colors, ...rest } = changes;
  return {
    ...rest,
    ...(images !== undefined && { images: encodeStringArray(images) }),
    ...(colors !== undefined && { colors: encodeStringArray(colors) }),
  };
}

async function assertOwnBrand(brandId: number, tenantKey: string): Promise<void> {
  const brand = await sqlitePrisma.brand.findFirst({ where: { id: brandId, tenantKey }, select: { id: true } });
  if (!brand) throw new LocalDbError(`brandId ${brandId} is not one of your brands.`, "invalid-reference");
}

// The brand is this table's one parent that must be synced (see SYNC_PARENTS in syncParents.ts); the check
// is the `brand: { synced: true, remoteId: { not: null } }` filter in pushRows below.
/**
 * Sends just-saved (inserted or updated) frames to the remote database in one request and marks them synced if it accepted
 * them. A frame whose brand isn't synced yet is held back: the remote database would either refuse its
 * brandId or, worse, match a different brand that happens to have the same number.
 * Returns the rows as they now stand.
 */
export async function pushRows(ids: string[], tenantKey: string): Promise<Frame[]> {
  const sendable = await sqlitePrisma.frame.findMany({
    where: { id: { in: ids }, tenantKey, brand: { synced: true, remoteId: { not: null } } },
    include: { brand: { select: { remoteId: true } } },
  });
  if (sendable.length) {
    await tryPush(`${sendable.length} frame(s)`, async () => {
      // brandId goes as the brand's id on the remote database, which differs from the local one.
      await remoteConnection.upsertMany(
      tenantKey,
      "frames",
        sendable.map(({ id, name, price, currency, images, shape, colors, stock, brand, categoryId, eyeSize, bridge, templeLength, reference, costPrice }) => ({
          id, name, price, currency, images: decodeStringArray(images), shape, colors: decodeStringArray(colors), stock, brandId: brand.remoteId!, categoryId,
          eyeSize, bridge, templeLength, reference, costPrice,
        })),
      );
      await sqlitePrisma.frame.updateMany({ where: { id: { in: sendable.map((f) => f.id) }, tenantKey }, data: { synced: true } });
    });
  }
  const fresh = await sqlitePrisma.frame.findMany({ where: { id: { in: ids }, tenantKey } });
  return ids.map((id) => toFrame(fresh.find((r) => r.id === id)!));
}

export const localFrameService = {
  async list(filter: { brandId?: number; categoryId?: number } = {}): Promise<Frame[]> {
    const tenantKey = await currentTenantKey();
    const rows = await sqlitePrisma.frame.findMany({ where: { tenantKey, ...filter }, orderBy: { name: "asc" } });
    return rows.map(toFrame);
  },

  async get(id: string): Promise<Frame | null> {
    const tenantKey = await currentTenantKey();
    const row = await sqlitePrisma.frame.findFirst({ where: { id, tenantKey } });
    return row ? toFrame(row) : null;
  },

  async insert(frame: NewFrame): Promise<Frame> {
    const tenantKey = await currentTenantKey();
    try {
      await assertOwnBrand(frame.brandId, tenantKey);
      const { id, ...rest } = frame;
      await sqlitePrisma.frame.create({ data: { id, ...toColumns(rest), tenantKey } as never });
    } catch (err) {
      translateError(err, "Insert frame");
    }
    await pushRow("frames", frame.id);
    return (await localFrameService.get(frame.id))!;
  },

  /** Inserts all the frames or none of them. */
  async insertMany(frames: NewFrame[]): Promise<Frame[]> {
    const tenantKey = await currentTenantKey();
    try {
      for (const brandId of new Set(frames.map((f) => f.brandId))) await assertOwnBrand(brandId, tenantKey);
      await sqlitePrisma.$transaction(
        frames.map(({ id, ...rest }) => sqlitePrisma.frame.create({ data: { id, ...toColumns(rest), tenantKey } as never })),
      );
    } catch (err) {
      translateError(err, "Insert frames");
    }
    return pushRows(frames.map((f) => f.id), tenantKey);
  },

  async update(id: string, changes: Partial<Omit<NewFrame, "id">>): Promise<Frame> {
    const tenantKey = await currentTenantKey();
    try {
      if (changes.brandId !== undefined) await assertOwnBrand(changes.brandId, tenantKey);
      const { count } = await sqlitePrisma.frame.updateMany({ where: { id, tenantKey }, data: { ...toColumns(changes), synced: false } });
      if (!count) throw new LocalDbError(`Update frame: no frame "${id}".`, "not-found");
    } catch (err) {
      translateError(err, "Update frame");
    }
    await pushRow("frames", id);
    return (await localFrameService.get(id))!;
  },

  async remove(id: string): Promise<void> {
    const tenantKey = await currentTenantKey();
    try {
      const { count } = await sqlitePrisma.frame.deleteMany({ where: { id, tenantKey } });
      if (!count) throw new LocalDbError(`Delete frame: no frame "${id}".`, "not-found");
    } catch (err) {
      translateError(err, "Delete frame");
    }
  },
};

registerPusher("frames", (ids, tenantKey) => pushRows(ids as string[], tenantKey));
