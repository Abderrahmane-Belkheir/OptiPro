// Photos: upload, download, delete one photo, and delete a product together with its photos.
// The files live in R2 (the `IMAGES` binding), one object per photo, named by the photo's id with its type
// stored alongside. The photo's row in product_images says whose it is.

import { authenticate } from './auth.js';
import { deletePhotoRow, findTenantByKey, photoRowExists, reservePhoto } from './db.js';
import { apiError, json, malformedAddress, decodeSegment, CORS } from './http.js';
import { IMAGE_ID, maxImageBytes, photoKey, PRODUCT_TYPES, SAFE_CODE, sniffImage } from './rules.js';

// Stored with the file, so the storage sends it when it serves the photo directly. A photo never changes (its id is unique).
const PHOTO_CACHE_CONTROL = 'public, max-age=86400';

const NO_BUCKET = () => apiError(500, 'SERVER_ERROR', 'Photo storage is not set up on the server (the IMAGES bucket is not bound).', { retry: 'same-request' });

/** Reads a request body into one buffer, giving up as soon as it grows past `max` (it is never held whole beyond that). */
async function readBody(request, max) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return { tooLarge: true };
  if (!request.body) return { bytes: new Uint8Array(0) };
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return { tooLarge: true };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { bytes };
}

/** The first of the stored object's names that exists: lets us tell whether a file was really there. */
const exists = async (bucket, id) => (await bucket.head(photoKey(id))) !== null;

/**
 * POST /api/images/<code>/<id>?type=frame|accessory     Authorization: Bearer <tenant key>     body = the image file
 *   201 { id, url: "/api/images/<id>", type, code, size, contentType }
 *
 * In this order (a failure leaves no row and no file behind):
 *   1. the tenant key must exist (401 / 429) - before the body is read;
 *   2. the request must be valid on its face: type, code and photo id (400), the body is a PNG, JPEG, WebP or GIF
 *      within the size limit (415, 413);
 *   3. ONE database request: the photo id must be new (409) and the row is inserted for this shop's product (404);
 *   4. the file is saved in R2; if that fails the row is taken back (500 SAVE_FAILED).
 */
export async function uploadPhoto(request, env, sql, url, rawCode, rawId) {
  if (!env.IMAGES) return NO_BUCKET();
  const auth = await authenticate(request, (key) => findTenantByKey(sql, key));
  if (auth.response) return auth.response;
  const { tenantKey } = auth;

  const type = url.searchParams.get('type');
  if (!PRODUCT_TYPES.includes(type)) {
    return apiError(400, 'INVALID_TYPE', `The "type" parameter must be exactly one of: ${PRODUCT_TYPES.join(', ')}. It says whether the code is the id of a frame or of an accessory.`, { allowed: PRODUCT_TYPES });
  }
  const code = decodeSegment(rawCode);
  const id = decodeSegment(rawId);
  if (code === null || id === null) return malformedAddress();
  if (!SAFE_CODE.test(code)) return apiError(400, 'INVALID_CODE', 'The code must be the id of a frame or accessory: 1-100 letters, digits, dots, dashes or underscores, starting with a letter or digit.');
  if (!IMAGE_ID.test(id)) return apiError(400, 'INVALID_PHOTO_ID', 'The photo id must be a UUID made up by the client, e.g. 3f6c1d7e-2b4a-4d8e-9a51-7c0e5b2a8f14.');
  const photoId = id.toLowerCase();

  const encoding = (request.headers.get('content-encoding') ?? 'identity').trim().toLowerCase();
  if (encoding !== 'identity') return apiError(415, 'UNSUPPORTED_ENCODING', 'The request body uses an encoding the server cannot read. Send the image file as is.');

  const max = maxImageBytes(env);
  let body;
  try {
    body = await readBody(request, max);
  } catch {
    return apiError(400, 'BAD_REQUEST_BODY', 'The request body could not be read completely. Send the request again.', { retry: 'same-request' });
  }
  if (body.tooLarge) return apiError(413, 'IMAGE_TOO_LARGE', `The image is larger than the ${Math.round(max / 1024 / 1024)} MB limit.`, { maxBytes: max });
  if (body.bytes.length === 0) return apiError(400, 'EMPTY_BODY', 'The request body must be the image file, but it is empty.');
  const image = sniffImage(body.bytes);
  if (!image) {
    return apiError(415, 'UNSUPPORTED_IMAGE', 'Only PNG, JPEG, WebP and GIF images are accepted (the type is read from the file itself, not from its name or Content-Type).', { allowed: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] });
  }

  const reserved = await reservePhoto(sql, { tenantKey, type, code, id: photoId });
  if (reserved === 'exists') {
    return apiError(409, 'PHOTO_ID_EXISTS', `A photo with the id ${photoId} already exists, so nothing was stored. Make up a new id and send the request again.`, { id: photoId, retry: 'new-id' });
  }
  if (reserved === 'no-product') {
    return apiError(404, 'PRODUCT_NOT_FOUND', `This shop has no ${type} with the id "${code}".`, { productType: type, productCode: code });
  }

  try {
    await env.IMAGES.put(photoKey(photoId), body.bytes, { httpMetadata: { contentType: image.contentType, cacheControl: PHOTO_CACHE_CONTROL } });
  } catch (err) {
    await deletePhotoRow(sql, { tenantKey, id: photoId }).catch((e) => console.error('Could not remove the product_images row after a failed save:', e.message));
    console.error('Could not save an uploaded image:', err.message);
    return apiError(500, 'SAVE_FAILED', 'The photo could not be saved on the server, so nothing was stored. The same request can be sent again.', { retry: 'same-request' });
  }
  // The product may have been deleted while the file was being saved: its photo rows went with it, and the delete's own removal of the
  // files may have run before this one existed. If the row is gone, the file is taken back (a photo nobody can reach).
  if (!(await photoRowExists(sql, photoId))) {
    await env.IMAGES.delete(photoKey(photoId)).catch((e) => console.error('Could not remove the file of a photo whose product was deleted:', e.message));
    return apiError(404, 'PRODUCT_NOT_FOUND', `This shop's ${type} "${code}" was deleted while the photo was being saved, so nothing was stored.`, { productType: type, productCode: code });
  }
  return json({ id: photoId, url: `/api/images/${photoId}`, type, code, size: body.bytes.length, contentType: image.contentType }, 201);
}

/** DELETE /api/images/<id> with the tenant key: the row goes first (filtered by tenant), then, only if a row was deleted, its file. */
export async function deletePhoto(request, env, sql, rawId) {
  if (!env.IMAGES) return NO_BUCKET();
  const auth = await authenticate(request, (key) => findTenantByKey(sql, key));
  if (auth.response) return auth.response;
  const id = decodeSegment(rawId);
  if (id === null) return malformedAddress();
  if (!IMAGE_ID.test(id)) return apiError(400, 'INVALID_PHOTO_ID', 'The photo id must be a UUID, e.g. 3f6c1d7e-2b4a-4d8e-9a51-7c0e5b2a8f14.');
  const photoId = id.toLowerCase();

  if (!(await deletePhotoRow(sql, { tenantKey: auth.tenantKey, id: photoId }))) {
    return apiError(404, 'PHOTO_NOT_FOUND', `This shop has no photo with the id ${photoId}, so nothing was deleted.`, { id: photoId });
  }
  let fileRemoved = false;
  try {
    fileRemoved = await exists(env.IMAGES, photoId);
    await env.IMAGES.delete(photoKey(photoId));
  } catch (err) {
    console.error(`Photo ${photoId}: its product_images row was deleted but its file could not be removed:`, err.message);
    return apiError(500, 'FILE_REMOVAL_FAILED', `The photo's record was deleted, but its file could not be removed from the server's storage. Contact the server's administrator with the photo id ${photoId}.`, { id: photoId, recordDeleted: true });
  }
  return json({ id: photoId, deleted: true, fileRemoved });
}

/** GET /api/images/<id>: a photo by its id. Public. */
export async function getPhoto(request, env, ctx, rawId) {
  if (!env.IMAGES) return NO_BUCKET();
  const id = decodeSegment(rawId);
  if (id === null || !IMAGE_ID.test(id)) return apiError(404, 'IMAGE_NOT_FOUND', 'No such image: a photo id is a UUID.');
  const photoId = id.toLowerCase();

  // A photo never changes once stored (its id is unique), so it is also kept at the edge.
  const cache = globalThis.caches?.default;
  const cacheKey = new Request(new URL(`/api/images/${photoId}`, request.url).href);
  const cached = cache ? await cache.match(cacheKey) : undefined;
  const ifNoneMatch = request.headers.get('if-none-match');
  if (cached) {
    if (ifNoneMatch && ifNoneMatch === cached.headers.get('etag')) return new Response(null, { status: 304, headers: { ETag: ifNoneMatch, ...CORS } });
    return cached;
  }

  const object = await env.IMAGES.get(photoKey(photoId));
  if (!object) return apiError(404, 'IMAGE_NOT_FOUND', 'No such image.');
  const headers = new Headers({
    'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
    'Cache-Control': PHOTO_CACHE_CONTROL,
    ETag: object.httpEtag,
    'X-Content-Type-Options': 'nosniff',
    ...CORS,
  });
  if (ifNoneMatch && ifNoneMatch === object.httpEtag) return new Response(null, { status: 304, headers });
  const response = new Response(object.body, { status: 200, headers });
  if (cache) ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
