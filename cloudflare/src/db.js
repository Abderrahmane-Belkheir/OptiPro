// Every database question the API asks, as plain SQL sent to Neon over HTTP (@neondatabase/serverless).
//
// Each function takes `sql` (the driver's client) and makes ONE request to Neon: `sql.transaction([...])` sends
// all the statements together and runs them in one transaction. The first statement of a read sets
// `app.tenant_key` (the setting the row-level-security policies compare each row's tenant_key against); the
// shop is found from the request's host inside that same request. Every query ALSO filters on the tenant's key
// itself: the policies do not apply to a role with BYPASSRLS, and the explicit filter is the one that always does.
//
// A frame's `images` (older photo codes) go out as codes only, as before; `imageIds` lists the ids of the photos
// the shop uploaded (product_images), which the website fetches with GET /api/images/<id>.

import { sqlState } from './http.js';

// ---- the tenant -------------------------------------------------------------------------------

/** Sets the tenant for this transaction from the request's host ('' for an unknown host: it matches no row). */
const tenantFromHost = (sql, host) =>
  sql.query("SELECT set_config('app.tenant_key', COALESCE((SELECT key FROM tenants WHERE host = $1), ''), true)", [host]);

/** Sets the tenant for this transaction from a key that has already been authenticated. */
const tenantFromKey = (sql, key) => sql.query("SELECT set_config('app.tenant_key', $1, true)", [key]);

/** The tenant with this key, or null: how a Bearer key is checked. */
export async function findTenantByKey(sql, key) {
  const rows = await sql.query('SELECT key FROM tenants WHERE key = $1', [key]);
  return rows[0] ?? null;
}

/**
 * The tenant with this key whose licence is running, or null: how the table API and photo uploads check a key. A key that does not exist, a key that
 * was never registered (its `expiry` is empty: only POST /api/register accepts that) and a key whose `expiry` day is already past all give the same
 * answer (null), so a client cannot tell them apart. The expiry day itself still counts (the date is compared with today's date in UTC).
 */
export async function findActiveTenant(sql, key) {
  const rows = await sql.query(
    "SELECT key, expiry FROM tenants WHERE key = $1 AND expiry IS NOT NULL AND expiry::date >= (now() AT TIME ZONE 'UTC')::date",
    [key],
  );
  return rows[0] ?? null;
}

/**
 * The tenant with this key that has never been registered (its `expiry` is still empty), or null: how POST /api/register checks a key. A key that
 * does not exist and a key that already has an expiry (registered before, running or expired) give the same answer (null).
 */
export async function findUnregisteredTenant(sql, key) {
  const rows = await sql.query('SELECT key FROM tenants WHERE key = $1 AND expiry IS NULL', [key]);
  return rows[0] ?? null;
}

/**
 * True when the shop served at this host name has an `expiry` that is past: its public website then shows nothing (403 LICENSE_EXPIRED). A shop whose
 * expiry is still empty (not registered yet) and a host that no shop uses are not expired.
 */
export async function isHostExpired(sql, host) {
  const rows = await sql.query("SELECT 1 AS expired FROM tenants WHERE host = $1 AND expiry IS NOT NULL AND expiry::date < (now() AT TIME ZONE 'UTC')::date", [host]);
  return rows.length > 0;
}

// ---- what the website reads -------------------------------------------------------------------

/** What a photo is sent as: its CODE, nothing else ("aviator-gold.jpg"), never a path or an address. */
export function toImageCode(stored) {
  if (typeof stored !== 'string') return null;
  const code = stored.split(/[?#]/)[0].split(/[\\/]/).filter(Boolean).pop()?.trim();
  return code || null;
}
const toImageCodes = (stored) => (Array.isArray(stored) ? stored : []).map(toImageCode).filter(Boolean);

export async function getCatalog(sql, host) {
  const [, categories, brands] = await sql.transaction([
    tenantFromHost(sql, host),
    sql.query('SELECT id, name, image_url AS url FROM categories ORDER BY id'),
    sql.query("SELECT id, name FROM brands WHERE tenant_key = current_setting('app.tenant_key') ORDER BY name, id"),
  ]);
  return { categories, brands };
}

export async function getSiteInfo(sql, host) {
  const [tenant] = await sql.query('SELECT name, instagram_url, tiktok_url, address, phone, email FROM tenants WHERE host = $1', [host]);
  if (!tenant) return null;
  return {
    name: tenant.name,
    social: [
      ...(tenant.instagram_url ? [{ label: 'Instagram', url: tenant.instagram_url }] : []),
      ...(tenant.tiktok_url ? [{ label: 'TikTok', url: tenant.tiktok_url }] : []),
    ],
    contact: { address: tenant.address, phone: tenant.phone, email: tenant.email },
  };
}

/** A cursor is the last item's name and code, so the next page starts right after it whatever was added meanwhile. */
export const encodeCursor = (name, id) => btoa(unescape(encodeURIComponent(JSON.stringify([name, id])))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function decodeCursor(cursor) {
  try {
    const [name, id] = JSON.parse(decodeURIComponent(escape(atob(cursor.replace(/-/g, '+').replace(/_/g, '/')))));
    return typeof name === 'string' && typeof id === 'string' ? { name, id } : null;
  } catch {
    return null;
  }
}

// One frame/accessory with its photo ids. A product goes out with its CODE (unique per shop), never its internal id; one without a code is not offered. `{where}` is extra conditions on the product `p`; params start at $2 ($1 is the host).
const FRAME_SELECT = `
  SELECT p.code, p.name, p.price, p.currency, p.images, p.shape, p.colors, p.stock, b.name AS brand, c.name AS category,
         COALESCE(json_agg(pi.id::text ORDER BY pi.id) FILTER (WHERE pi.id IS NOT NULL), '[]') AS "imageIds"
    FROM frames p
    JOIN brands b ON b.id = p.brand_id
    JOIN categories c ON c.id = p.category_id
    LEFT JOIN product_images pi ON pi.frame_id = p.id AND pi.tenant_key = p.tenant_key`;

const ACCESSORY_SELECT = `
  SELECT p.code, p.name, p.description, p.price, p.currency, p.images, p.stock,
         COALESCE(json_agg(pi.id::text ORDER BY pi.id) FILTER (WHERE pi.id IS NOT NULL), '[]') AS "imageIds"
    FROM accessories p
    LEFT JOIN product_images pi ON pi.accessory_id = p.id AND pi.tenant_key = p.tenant_key`;

const reshapeFrame = ({ stock, images, ...frame }) => ({ ...frame, images: toImageCodes(images), inStock: stock > 0 });
const reshapeAccessory = reshapeFrame;

/**
 * A page of products: at most `limit` of them, in name order, starting right after `cursor` (a decoded cursor or
 * null). Answers { items, total, next }: `total` counts everything the filter matches (not just this page) and
 * `next` is the cursor of the next page (null on the last one). `where` is extra SQL over the product `p` using
 * $1.. for `params`. The page and its total are two statements of the SAME request, so they always agree.
 */
async function pageWithTotal(sql, args) {
  const { host, table, where, params } = args;
  const bind = params;
  const keyset = args.cursor ? `AND (p.name, p.code) > ($${bind.length + 1}, $${bind.length + 2})` : '';
  const filter = `p.tenant_key = current_setting('app.tenant_key') AND p.code IS NOT NULL ${where}`;
  const pageParams = args.cursor ? [...bind, args.cursor.name, args.cursor.id] : bind;
  const [, rows, count] = await sql.transaction([
    tenantFromHost(sql, host),
    sql.query(`${args.select} WHERE ${filter} ${keyset} GROUP BY ${args.groupBy} ORDER BY p.name, p.code LIMIT ${Number(args.limit) + 1}`, pageParams),
    sql.query(`SELECT count(*)::int AS total FROM ${table} p WHERE ${filter}`, bind),
  ]);
  const items = rows.slice(0, args.limit);
  const hasMore = rows.length > args.limit;
  const last = items[items.length - 1];
  return { items: items.map(args.reshape), total: count[0].total, next: hasMore && last ? encodeCursor(last.name, last.code) : null };
}
export function getFrames(sql, { host, brandId, categoryId, limit, cursor }) {
  return pageWithTotal(sql, {
    host, limit, cursor, table: 'frames', select: FRAME_SELECT, groupBy: 'p.id, b.name, c.name',
    where: 'AND p.brand_id = $1 AND p.category_id = $2', params: [brandId, categoryId], reshape: reshapeFrame,
  });
}

export function getAccessories(sql, { host, limit, cursor }) {
  return pageWithTotal(sql, {
    host, limit, cursor, table: 'accessories', select: ACCESSORY_SELECT, groupBy: 'p.id',
    where: '', params: [], reshape: reshapeAccessory,
  });
}

// By code, within the shop of the host (two shops can have the same code); the code is looked up in lowercase.
async function byCode(sql, { host, select, groupBy, code, reshape }) {
  const [, rows] = await sql.transaction([
    tenantFromHost(sql, host),
    sql.query(`${select} WHERE p.tenant_key = current_setting('app.tenant_key') AND p.code = $1 GROUP BY ${groupBy}`, [String(code).trim().toLowerCase()]),
  ]);
  return rows[0] ? reshape(rows[0]) : null;
}

export const getFrameByCode = (sql, host, code) => byCode(sql, { host, select: FRAME_SELECT, groupBy: 'p.id, b.name, c.name', code, reshape: reshapeFrame });
export const getAccessoryByCode = (sql, host, code) => byCode(sql, { host, select: ACCESSORY_SELECT, groupBy: 'p.id', code, reshape: reshapeAccessory });

// ---- photos -----------------------------------------------------------------------------------

/**
 * Reserves a photo's row: ONE request that (1) says whether the photo id exists already and (2) inserts the
 * row, with the client's id as its primary key, for the frame (or accessory) whose id is `code` AND whose tenant
 * is the caller's. The insert's own filter decides whether the product exists, so it is never looked up first.
 *
 * Answers 'exists' (the id is taken), 'no-product' (this shop has no such frame/accessory) or 'inserted'.
 * If two requests race with the same id the primary key lets one through and the other gets 'exists'.
 */
export const RESERVE_EXISTS_SQL = 'SELECT EXISTS (SELECT 1 FROM product_images WHERE id = $1::uuid) AS found';
/** The insert for a frame ('frame') or an accessory: params are [photo id, product id, tenant key]. */
export const reserveInsertSql = (type) => {
  const column = type === 'frame' ? 'frame_id' : 'accessory_id';
  const table = type === 'frame' ? 'frames' : 'accessories';
  return `INSERT INTO product_images (id, tenant_key, ${column})
         SELECT $1::uuid, p.tenant_key, p.id FROM ${table} p
          WHERE p.id = $2 AND p.tenant_key = $3 AND NOT EXISTS (SELECT 1 FROM product_images WHERE id = $1::uuid)
         RETURNING id::text AS id`;
};

/** Whether the photo's row still exists (the product it belongs to may have been deleted since the row was reserved). */
export async function photoRowExists(sql, id) {
  const [row] = await sql.query(RESERVE_EXISTS_SQL, [id]);
  return Boolean(row?.found);
}

export async function reservePhoto(sql, { tenantKey, type, code, id }) {
  try {
    const [, existing, inserted] = await sql.transaction([
      tenantFromKey(sql, tenantKey),
      sql.query(RESERVE_EXISTS_SQL, [id]),
      sql.query(reserveInsertSql(type), [id, code, tenantKey]),
    ]);
    if (existing[0].found) return 'exists';
    return inserted.length > 0 ? 'inserted' : 'no-product';
  } catch (err) {
    const state = sqlState(err);
    if (state === '23505') return 'exists'; // unique_violation: the id was taken a moment ago
    if (state === '23503') return 'no-product'; // foreign_key_violation: the product was deleted in the meantime
    throw err;
  }
}

/** Deletes the product_images row with this id that belongs to this tenant, and says whether there was one. */
export async function deletePhotoRow(sql, { tenantKey, id }) {
  const [, rows] = await sql.transaction([
    tenantFromKey(sql, tenantKey),
    sql.query('DELETE FROM product_images WHERE id = $1::uuid AND tenant_key = $2 RETURNING id::text AS id', [id, tenantKey]),
  ]);
  return rows.length > 0;
}
