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
