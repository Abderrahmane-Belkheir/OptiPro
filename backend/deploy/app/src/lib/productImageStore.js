import { withTenant } from './tenantContext.js';
import { prisma } from './prismaClient.js';

/** Whether a product_images row with this id exists (the id is the table's primary key, so it is unique across shops). */
export async function productImageExists({ id }) {
  const rows = await prisma.$queryRaw`SELECT 1 AS found FROM product_images WHERE id = ${id}::uuid LIMIT 1`;
  return rows.length > 0;
}

/**
 * Inserts a row into product_images, with `id` (made up by the client) as its primary key, for the frame
 * (type "frame") or accessory (type "accessory") whose id is `code` AND whose tenant is `tenantKey`.
 * Returns the id, or null when there is no such product under that tenant.
 *
 * It is ONE statement, INSERT … SELECT: the SELECT's filter (id AND tenant_key) decides whether a row is
 * inserted at all, so the product is never looked up separately first. A product of another tenant with
 * the same id matches nothing. If the photo id is taken by the time the row is written (two requests
 * with the same id at once) the primary key refuses it and an error with `code: 'PHOTO_ID_TAKEN'` is thrown.
 */
export async function insertProductImage({ tenantKey, type, code, id }) {
  try {
    const rows = await withTenant(tenantKey, (tx) =>
      type === 'frame'
        ? tx.$queryRaw`
            INSERT INTO product_images (id, tenant_key, frame_id)
            SELECT ${id}::uuid, f.tenant_key, f.id FROM frames f WHERE f.id = ${code} AND f.tenant_key = ${tenantKey}
            RETURNING id::text AS id`
        : tx.$queryRaw`
            INSERT INTO product_images (id, tenant_key, accessory_id)
            SELECT ${id}::uuid, a.tenant_key, a.id FROM accessories a WHERE a.id = ${code} AND a.tenant_key = ${tenantKey}
            RETURNING id::text AS id`,
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    // Postgres' unique_violation (23505) on the primary key: the id was taken in the meantime.
    if (/23505|duplicate key value/.test(`${err?.code ?? ''} ${err?.meta?.code ?? ''} ${err?.message ?? ''}`)) {
      throw Object.assign(new Error('A photo with this id already exists.'), { code: 'PHOTO_ID_TAKEN' });
    }
    // Postgres' foreign_key_violation (23503): the product was found by the SELECT but deleted before the
    // row could be written (a delete of the product ran at the same moment). It is gone: same as not found.
    if (/23503|violates foreign key constraint/.test(`${err?.code ?? ''} ${err?.meta?.code ?? ''} ${err?.message ?? ''}`)) {
      return null;
    }
    throw err;
  }
}

/**
 * Deletes the product_images row with this id that belongs to this tenant, and says whether there was
 * one. ONE statement, `DELETE … WHERE id AND tenant_key … RETURNING id`: a row of another tenant matches
 * nothing and is left alone. Also used to take back a row whose file could not be saved.
 */
export async function deleteProductImage({ tenantKey, id }) {
  const rows = await withTenant(
    tenantKey,
    (tx) => tx.$queryRaw`DELETE FROM product_images WHERE id = ${id}::uuid AND tenant_key = ${tenantKey} RETURNING id::text AS id`,
  );
  return rows.length > 0;
}

/** Thrown by deleteProductWithPhotos when other records still refer to the product (a foreign key refuses the delete). */
export class ProductInUseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProductInUseError';
    this.code = 'PRODUCT_IN_USE';
  }
}

/**
 * Deletes a frame (type "frame") or an accessory (type "accessory") of this tenant together with its
 * photos' rows, and returns the ids of those photos, or null when the tenant has no such product.
 *
 * One transaction, in this order:
 *   1. SELECT … FOR UPDATE on the product (id AND tenant_key): this locks it, so a photo being uploaded for
 *      it at this moment (its row insert needs a share lock on the product) waits instead of slipping in
 *      between steps 2 and 3, and no row is found for another tenant's product;
 *   2. the ids of its product_images rows are fetched;
 *   3. the product is deleted (its photo rows go with it: the foreign key cascades).
 * The ids are returned only once the transaction has COMMITTED, so the caller deletes the files of photos
 * that really are gone, and never of a product whose deletion failed. If another table refers to the
 * product (for example an order line) and refuses the delete, nothing changes and ProductInUseError is thrown.
 */
export async function deleteProductWithPhotos({ tenantKey, type, id }) {
  try {
    return await withTenant(tenantKey, async (tx) => {
      const locked = type === 'frame'
        ? await tx.$queryRaw`SELECT id FROM frames WHERE id = ${id} AND tenant_key = ${tenantKey} FOR UPDATE`
        : await tx.$queryRaw`SELECT id FROM accessories WHERE id = ${id} AND tenant_key = ${tenantKey} FOR UPDATE`;
      if (locked.length === 0) return null;
      const photos = type === 'frame'
        ? await tx.$queryRaw`SELECT id::text AS id FROM product_images WHERE frame_id = ${id} AND tenant_key = ${tenantKey}`
        : await tx.$queryRaw`SELECT id::text AS id FROM product_images WHERE accessory_id = ${id} AND tenant_key = ${tenantKey}`;
      if (type === 'frame') await tx.$executeRaw`DELETE FROM frames WHERE id = ${id} AND tenant_key = ${tenantKey}`;
      else await tx.$executeRaw`DELETE FROM accessories WHERE id = ${id} AND tenant_key = ${tenantKey}`;
      return photos.map((photo) => photo.id);
    });
  } catch (err) {
    // Postgres' foreign_key_violation (23503) / restrict_violation (23001): something else still points at it.
    if (/23503|23001|violates foreign key constraint/.test(`${err?.code ?? ''} ${err?.meta?.code ?? ''} ${err?.message ?? ''}`)) {
      throw new ProductInUseError('Other records still refer to this product.');
    }
    throw err;
  }
}
