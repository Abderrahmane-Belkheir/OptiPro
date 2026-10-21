import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';

/** URL prefix the stored files are served under (server.js mounts the images directory there). */
export const IMAGES_URL_PREFIX = '/images';

const MAX_BYTES = Number(process.env.IMAGE_MAX_BYTES) || 5 * 1024 * 1024;

// Wrong keys are counted per client address; too many in a window and that address is told to wait.
const MAX_FAILED_ATTEMPTS = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

// A tenant key becomes a folder name, so only plain characters are accepted before anything else
// is done with it (this alone rules out "..", slashes and the like).
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

// The code becomes a file name, under the same rule: plain characters, starting with a letter or
// digit (so no hidden files and no ".."), no slashes.
const SAFE_CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

// A host name as it appears in an address: dot-separated labels of letters, digits and dashes.
const SAFE_HOST = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/;

const EXTENSIONS = ['png', 'jpg', 'webp', 'gif'];
const KNOWN_EXTENSION = /\.(png|jpe?g|webp|gif)$/i;

/**
 * What the bytes really are. The Content-Type header and the code's ending come from the client and
 * prove nothing, so the type is read from the file's first bytes. Only formats a browser can draw
 * without running anything are accepted: no SVG (it can carry scripts and would be served from the
 * site's own address).
 */
function sniffImage(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: 'png', contentType: 'image/png' };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: 'jpg', contentType: 'image/jpeg' };
  }
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('latin1'))) {
    return { ext: 'gif', contentType: 'image/gif' };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { ext: 'webp', contentType: 'image/webp' };
  }
  return null;
}

const exists = (file) => fs.access(file).then(() => true, () => false);

// A photo's id: a UUID (the client makes it up, the images folder names the file after it).
const IMAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every failure of an upload is answered as JSON the same way, so a client can tell what is wrong
 * without parsing sentences:
 *
 *   { "error": "<what happened, in words>", "code": "<STABLE_MACHINE_CODE>", ...details }
 *
 * (Details never reuse the names `error` and `code`: PRODUCT_NOT_FOUND names the product as `productType` and `productCode`.)
 * `code` is one of: UNAUTHORIZED (401), TOO_MANY_ATTEMPTS (429), INVALID_TYPE, INVALID_CODE,
 * INVALID_PHOTO_ID, EMPTY_BODY, MALFORMED_ADDRESS, BAD_ENCODED_BODY (400), UNSUPPORTED_IMAGE, UNSUPPORTED_ENCODING (415), IMAGE_TOO_LARGE (413),
 * PRODUCT_NOT_FOUND, PHOTO_NOT_FOUND, WRONG_ADDRESS (404), METHOD_NOT_ALLOWED (405), PHOTO_ID_EXISTS (409), BAD_REQUEST_BODY (400),
 * SAVE_FAILED, FILE_REMOVAL_FAILED, SERVER_ERROR (500). Where sending the request again can help it says how, in `retry`:
 * "new-id" (PHOTO_ID_EXISTS: make up another photo id), "same-request" (SAVE_FAILED, SERVER_ERROR,
 * BAD_REQUEST_BODY) or "after-delay" (TOO_MANY_ATTEMPTS, with `retryAfterSeconds`). A failed upload never
 * leaves a row or a file behind.
 */
export function uploadError(res, status, code, error, extra = {}) {
  res.status(status).json({ error, code, ...extra });
}

/** What a photo can belong to; the `type` request parameter says which. */
export const PRODUCT_TYPES = ['frame', 'accessory'];

/**
 * Express middleware that identifies a shop by its tenant key (`Authorization: Bearer <key>`): the key must
 * exist in the tenants table (`findTenantByKey`). On success `req.tenantKey` is set. A wrong key is a 401
 * {code: UNAUTHORIZED}; 10 wrong keys from one address within 15 minutes block that address for the rest of
 * the window (429 {code: TOO_MANY_ATTEMPTS}). Failures other than a wrong key never count.
 */
export function createTenantAuthenticator(findTenantByKey) {
  const failures = new Map(); // client address -> { count, resetAt }

  const blockedForMs = (ip) => {
    const entry = failures.get(ip);
    if (!entry) return 0;
    if (entry.resetAt <= Date.now()) {
      failures.delete(ip);
      return 0;
    }
    return entry.count >= MAX_FAILED_ATTEMPTS ? entry.resetAt - Date.now() : 0;
  };
  const recordFailure = (ip) => {
    const entry = failures.get(ip);
    if (!entry || entry.resetAt <= Date.now()) failures.set(ip, { count: 1, resetAt: Date.now() + FAILURE_WINDOW_MS });
    else entry.count += 1;
  };

  return async function authenticate(req, res, next) {
    const header = req.get('authorization') ?? '';
    const key = /^Bearer\s+(\S+)\s*$/i.exec(header)?.[1];
    const tenant = key && SAFE_KEY.test(key) ? await findTenantByKey(key) : null;
    // A valid key is never slowed down: many shops can share one address (one ISP connection), and the wrong keys of one must not block the others.
    if (tenant && tenant.key === key) {
      req.tenantKey = tenant.key;
      next();
      return;
    }
    const wait = blockedForMs(req.ip);
    if (wait > 0) {
      const seconds = Math.ceil(wait / 1000);
      res.set('Retry-After', String(seconds));
      uploadError(res, 429, 'TOO_MANY_ATTEMPTS', `Too many requests with a wrong tenant key from this address. Try again in ${seconds} seconds.`, { retry: 'after-delay', retryAfterSeconds: seconds });
      return;
    }
    recordFailure(req.ip);
    res.set('WWW-Authenticate', 'Bearer');
    uploadError(res, 401, 'UNAUTHORIZED', 'A valid tenant key is required: send it as "Authorization: Bearer <tenant key>".');
  };
}

/**
 * Removes the file(s) of a photo from the images folder: <id>.png|.jpg|.webp|.gif, or a file named by the
 * bare id. Resolves to whether anything was removed; a file that is already missing is fine, any other
 * failure (permissions, a directory in the way, ...) throws.
 */
export async function removePhotoFiles(imagesDir, id) {
  let removed = false;
  for (const name of [...EXTENSIONS.map((ext) => `${id}.${ext}`), id]) {
    try {
      await fs.unlink(path.join(imagesDir, name));
      removed = true;
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err;
    }
  }
  return removed;
}

/**
 * Upload of a photo of a frame or an accessory (the router is mounted at /api/images):
 *
 *   POST /api/images/<code>/<id>?type=frame        (or type=accessory)
 *   Authorization: Bearer <tenant key>
 *   Content-Type: image/jpeg                       <- the body is the image file itself
 *
 *   201 { "id": "<id>", "url": "/api/images/<id>", "type": "frame", "code": "<code>", "size": 48211, "contentType": "image/jpeg" }
 *
 * <code> is the id of the frame or accessory the photo is for; <id> is the id of the PHOTO, a UUID the
 * client makes up (and sends again if it ever has to retry the same photo). What happens, in this order:
 *
 *   1. the tenant key must exist in the tenants table and, for an upload, not be expired (`findActiveTenant`) -> 401 otherwise
 *   2. the request must be valid on its face, without asking the database anything:
 *      `type` is frame or accessory (400), the code is a plain id (400), the photo id is a UUID (400),
 *      the body is a PNG, JPEG, WebP or GIF within the size limit (415, 413)
 *   3. the photo id must be new: `productImageExists` looks it up in product_images       -> 409 if it exists
 *   4. `insertProductImage` makes ONE query that inserts the row, with the client's id as its primary
 *      key, for the frame (or accessory) whose id is <code> AND whose tenant is the caller's. The
 *      query's own filter decides: no such product under this tenant means no row -> 404. Nothing
 *      checks for the product beforehand. (If two requests race with the same photo id, the primary
 *      key lets only one through; the other is a 409 too.)
 *   5. the file is saved as <images dir>/<id>.<type of the file>. If saving fails, the row is removed
 *      again (`deleteProductImage`) so no row points at a missing file.
 *
 * Every upload adds a photo (a product can have several); the photo is fetched with GET /api/images/<id>.
 * Every failure is answered as { error, code, ...details } (see uploadError) and leaves nothing behind.
 */
export function createImageRouter({ findTenantByKey, findActiveTenant = findTenantByKey, productImageExists, insertProductImage, deleteProductImage, imagesDir }) {
  const router = express.Router();
  // 1. Authentication comes first, before the body is read: a caller without a valid key never gets
  // the server to buffer a file.
  const authenticate = createTenantAuthenticator(findTenantByKey);
  // An upload also needs the shop's licence not to be expired (findActiveTenant: a key that does not exist and an expired key give the same 401).
  const authenticateUpload = createTenantAuthenticator(findActiveTenant);

  // 2a. The parts of the request that can be judged without the body.
  function validateRequest(req, res, next) {
    const { type } = req.query;
    if (!PRODUCT_TYPES.includes(type)) {
      uploadError(res, 400, 'INVALID_TYPE', `The "type" parameter must be exactly one of: ${PRODUCT_TYPES.join(', ')}. It says whether the code is the id of a frame or of an accessory.`, { allowed: PRODUCT_TYPES });
      return;
    }
    if (!SAFE_CODE.test(req.params.code)) {
      uploadError(res, 400, 'INVALID_CODE', 'The code must be the id of a frame or accessory: 1-100 letters, digits, dots, dashes or underscores, starting with a letter or digit.');
      return;
    }
    if (!IMAGE_ID.test(req.params.id)) {
      uploadError(res, 400, 'INVALID_PHOTO_ID', 'The photo id must be a UUID made up by the client, e.g. 3f6c1d7e-2b4a-4d8e-9a51-7c0e5b2a8f14.');
      return;
    }
    next();
  }

  router.post('/:code/:id', authenticateUpload, validateRequest, express.raw({ type: () => true, limit: MAX_BYTES }), async (req, res) => {
    const { code } = req.params;
    const id = req.params.id.toLowerCase();
    const { type } = req.query;

    // 2b. The body.
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      uploadError(res, 400, 'EMPTY_BODY', 'The request body must be the image file, but it is empty.');
      return;
    }
    const image = sniffImage(req.body);
    if (!image) {
      uploadError(res, 415, 'UNSUPPORTED_IMAGE', 'Only PNG, JPEG, WebP and GIF images are accepted (the type is read from the file itself, not from its name or Content-Type).', { allowed: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] });
      return;
    }

    // 3. The photo id must not be in use already.
    if (await productImageExists({ id })) {
      uploadError(res, 409, 'PHOTO_ID_EXISTS', `A photo with the id ${id} already exists, so nothing was stored. Make up a new id and send the request again.`, { id, retry: 'new-id' });
      return;
    }

    // 4. The insert, with the client's id as the primary key, whose filter (this tenant's frame/accessory
    // with this id) decides whether the product exists.
    try {
      if (!(await insertProductImage({ tenantKey: req.tenantKey, type, code, id }))) {
        uploadError(res, 404, 'PRODUCT_NOT_FOUND', `This shop has no ${type} with the id "${code}".`, { productType: type, productCode: code });
        return;
      }
    } catch (err) {
      if (err?.code === 'PHOTO_ID_TAKEN') {
        uploadError(res, 409, 'PHOTO_ID_EXISTS', `A photo with the id ${id} already exists (it was taken a moment ago), so nothing was stored. Make up a new id and send the request again.`, { id, retry: 'new-id' });
        return;
      }
      throw err;
    }

    // 5. The file, named by the photo's id.
    const target = path.join(imagesDir, `${id}.${image.ext}`);
    const temporary = path.join(imagesDir, `.${id}.part`);
    try {
      await fs.mkdir(imagesDir, { recursive: true, mode: 0o755 });
      // Written under a temporary name and renamed, so a half-written file is never served.
      await fs.writeFile(temporary, req.body, { mode: 0o644 });
      await fs.rename(temporary, target);
    } catch (err) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      await deleteProductImage({ tenantKey: req.tenantKey, id }).catch((e) => console.error('Could not remove the product_images row after a failed save:', e.message));
      console.error('Could not save an uploaded image:', err.message);
      uploadError(res, 500, 'SAVE_FAILED', 'The photo could not be saved on the server, so nothing was stored. The same request can be sent again.', { retry: 'same-request' });
      return;
    }

    // The product may have been deleted while the file was being written: its photo rows went with it, and the delete's own removal of
    // the files may have run before this one existed. If the row is gone, the file is taken back (a photo nobody can reach).
    if (!(await productImageExists({ id }))) {
      await fs.rm(target, { force: true }).catch(() => {});
      uploadError(res, 404, 'PRODUCT_NOT_FOUND', `This shop's ${type} "${code}" was deleted while the photo was being saved, so nothing was stored.`, { productType: type, productCode: code });
      return;
    }

    res.status(201).json({ id, url: `/api/images/${id}`, type, code, size: req.body.length, contentType: image.contentType });
  });

  // Deleting a photo: DELETE /api/images/<id> with the tenant key. The row goes first, with the tenant
  // in the same statement (so one shop can never delete another's photo); only if a row was deleted is the
  // file removed from the disk.
  router.delete('/:id', authenticate, async (req, res) => {
    const id = req.params.id.toLowerCase();
    if (!IMAGE_ID.test(id)) {
      uploadError(res, 400, 'INVALID_PHOTO_ID', 'The photo id must be a UUID, e.g. 3f6c1d7e-2b4a-4d8e-9a51-7c0e5b2a8f14.');
      return;
    }
    if (!(await deleteProductImage({ tenantKey: req.tenantKey, id }))) {
      uploadError(res, 404, 'PHOTO_NOT_FOUND', `This shop has no photo with the id ${id}, so nothing was deleted.`, { id });
      return;
    }
    let fileRemoved = false;
    try {
      fileRemoved = await removePhotoFiles(imagesDir, id);
    } catch (err) {
      console.error(`Photo ${id}: its product_images row was deleted but its file could not be removed:`, err.message);
      uploadError(res, 500, 'FILE_REMOVAL_FAILED', `The photo's record was deleted, but its file could not be removed from the server's disk. Contact the server's administrator with the photo id ${id}.`, { id, recordDeleted: true });
      return;
    }
    res.json({ id, deleted: true, fileRemoved });
  });

  // The upload lives at /api/images/<code>/<id> only: say so for the nearby mistakes instead of a bare 404.
  router.post('/:code', (req, res) => {
    uploadError(res, 404, 'WRONG_ADDRESS', 'The photo id is missing from the address. Upload with POST /api/images/<code>/<id>?type=frame|accessory.', { expected: 'POST /api/images/{code}/{id}?type=frame|accessory' });
  });
  router.all('/:code/:id', (req, res) => {
    res.set('Allow', 'POST');
    uploadError(res, 405, 'METHOD_NOT_ALLOWED', `${req.method} is not allowed here: upload with POST /api/images/<code>/<id>?type=frame|accessory.`, { allowed: ['POST'] });
  });

  // Errors raised while reading the body (that are the caller's doing) and anything unexpected.
  router.use((err, _req, res, next) => {
    if (res.headersSent) return next(err);
    if (err?.type === 'entity.too.large') {
      return uploadError(res, 413, 'IMAGE_TOO_LARGE', `The image is larger than the ${Math.round(MAX_BYTES / 1024 / 1024)} MB limit.`, { maxBytes: MAX_BYTES });
    }
    if (err?.type === 'encoding.unsupported' || err?.type === 'charset.unsupported') {
      return uploadError(res, 415, 'UNSUPPORTED_ENCODING', 'The request body uses an encoding the server cannot read. Send the image file as is, or gzip/deflate-encoded.');
    }
    if (err instanceof URIError || err?.status === 400 && /decode/i.test(err?.message ?? '')) {
      return uploadError(res, 400, 'MALFORMED_ADDRESS', 'The address contains an invalid percent-escape. The code and the photo id are plain characters and need no escaping.');
    }
    if (typeof err?.code === 'string' && err.code.startsWith('Z_') || /decompression failed|incorrect header check|unexpected end of file|invalid (stored block|distance|code)/i.test(err?.message ?? '')) {
      return uploadError(res, 400, 'BAD_ENCODED_BODY', 'The request body says it is compressed (Content-Encoding) but could not be decoded. Send the image file as is, or correctly gzip/deflate/br-encoded.');
    }
    if (err?.type === 'request.aborted' || err?.type === 'request.size.invalid') {
      return uploadError(res, 400, 'BAD_REQUEST_BODY', 'The request body could not be read completely. Send the request again.', { retry: 'same-request' });
    }
    console.error('Upload failed:', err);
    return uploadError(res, 500, 'SERVER_ERROR', 'The upload could not be completed because of a problem on the server. Nothing was stored; the same request can be sent again.', { retry: 'same-request' });
  });

  return router;
}

/**
 * GET /images/<host>/<code> — the public read side of the uploads, no authentication (anyone with
 * the address can fetch the photo, like any image on a website).
 *
 *   GET /images/maison-clair.example.com/aviator-gold      -> aviator-gold.jpg (whatever type it was stored as)
 *   GET /images/maison-clair.example.com/aviator-gold.jpg  -> the same photo
 *
 * The address carries the shop's HOST NAME, never its tenant key: the key is the shop's upload
 * credential and must not appear in a public address. The server finds the key itself, from the
 * tenants table (`findKeyByHost`), and reads <imagesDir>/<tenant key>/<code> — the same file an
 * upload stored. The code may be given with or without an extension, matching how uploads treat it;
 * an exact file name wins when it exists. Nothing here can leave the shop's folder: the host and the
 * code must be plain names, and hidden files (including the ".part" files of an upload in progress)
 * are never served.
 *
 * A request whose host is not a shop's is passed on (`next()`), so the older photos in public/images/
 * (laid out differently, e.g. /images/frames/aviator.svg) keep working — also when the tenants table
 * can't be read. A missing photo for a real shop is a plain 404, not the website's fallback page.
 * `legacyDirs` lists folders of older, shared photos to look in when the shop's own folder has none.
 */
export function createImageFileRouter({ imagesDir, findKeyByHost, legacyDirs = [] }) {
  const router = express.Router();
  const lookup = cached(findKeyByHost);
  const legacyFolders = legacyDirs.map((dir) => path.resolve(dir)); // as the file system spells them (one slash style, no "..")

  router.get('/:host/:code', async (req, res, next) => {
    const { code } = req.params;
    const host = req.params.host.toLowerCase();
    if (!SAFE_HOST.test(host) || !SAFE_CODE.test(code)) {
      next();
      return;
    }

    let tenantKey;
    try {
      tenantKey = await lookup(host);
    } catch (err) {
      console.warn(`Could not look up the shop for "${host}" (image request passed on):`, err.message);
      next();
      return;
    }
    if (!tenantKey || !SAFE_KEY.test(tenantKey)) {
      next();
      return;
    }

    const folder = path.join(imagesDir, tenantKey);
    const stem = code.replace(KNOWN_EXTENSION, '');
    const candidates = [code, ...EXTENSIONS.map((ext) => `${stem}.${ext}`)];
    for (const name of candidates) {
      if (!KNOWN_EXTENSION.test(name)) continue;
      const file = path.join(folder, name);
      if (path.dirname(file) !== folder) continue;
      if (await fs.stat(file).then((st) => st.isFile(), () => false)) {
        res.sendFile(file, {
          dotfiles: 'deny',
          maxAge: '1d',
          headers: { 'X-Content-Type-Options': 'nosniff' },
        });
        return;
      }
    }
    // Not an upload of this shop's: the older sample photos (public/images/frames, .../accessories,
    // including SVGs) are found by the same code, so rows that still point at them keep working.
    for (const legacyDir of legacyFolders) {
      const file = path.join(legacyDir, code);
      if (path.dirname(file) !== legacyDir) continue;
      if (await fs.stat(file).then((st) => st.isFile(), () => false)) {
        res.sendFile(file, { dotfiles: 'deny', maxAge: '1d', headers: { 'X-Content-Type-Options': 'nosniff' } });
        return;
      }
    }
    res.status(404).json({ error: 'No such image.' });
  });

  return router;
}

/** Remembers each host's answer (also "no such shop") for a minute, so image requests don't each hit the database. */
function cached(find, ttlMs = 60_000, maxEntries = 500) {
  const memory = new Map(); // host -> { value, expires }
  return async (host) => {
    const hit = memory.get(host);
    if (hit && hit.expires > Date.now()) return hit.value;
    const value = (await find(host)) ?? null;
    if (memory.size >= maxEntries) memory.delete(memory.keys().next().value);
    memory.set(host, { value, expires: Date.now() + ttlMs });
    return value;
  };
}

const CONTENT_TYPE_BY_EXTENSION = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

/**
 * GET /api/images/:id — a photo by its id (the ids a frame or accessory lists in `imageIds`). Public.
 *
 * The photos for this endpoint live directly in the images folder, the same for every shop:
 * <imagesDir>/<id> (also <imagesDir>/<id>.png, .jpg, .webp or .gif). The handler checks whether such a
 * file exists and sends it, or answers 404. The id must be a UUID, so nothing but a plain file name is
 * ever looked up (no way out of the folder), and only a regular file counts (a shop's folder, which
 * is named by its key, is never sent).
 */
export function createImageByIdHandler({ imagesDir }) {
  return async (req, res) => {
    const { id } = req.params;
    if (!IMAGE_ID.test(id)) {
      res.status(404).json({ error: 'No such image: a photo id is a UUID.', code: 'IMAGE_NOT_FOUND' });
      return;
    }
    const base = id.toLowerCase();

    for (const name of [...EXTENSIONS.map((ext) => `${base}.${ext}`), base]) {
      const file = path.join(imagesDir, name);
      if (path.resolve(path.dirname(file)) !== path.resolve(imagesDir)) continue;
      if (!(await fs.stat(file).then((st) => st.isFile(), () => false))) continue;

      // A file named by the bare id has no extension to say what it is: read it from its first bytes.
      let contentType = CONTENT_TYPE_BY_EXTENSION[path.extname(name).slice(1)];
      if (!contentType) {
        const handle = await fs.open(file, 'r');
        try {
          const head = Buffer.alloc(16);
          const { bytesRead } = await handle.read(head, 0, 16, 0);
          contentType = sniffImage(head.subarray(0, bytesRead))?.contentType;
        } finally {
          await handle.close();
        }
        if (!contentType) continue; // not an image: never sent
      }
      res.type(contentType);
      res.sendFile(file, { dotfiles: 'deny', maxAge: '1d', headers: { 'X-Content-Type-Options': 'nosniff', 'Content-Type': contentType } });
      return;
    }
    res.status(404).json({ error: 'No such image.', code: 'IMAGE_NOT_FOUND' });
  };
}
