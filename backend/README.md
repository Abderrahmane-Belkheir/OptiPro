# Optician Backend

A small multi-tenant Express API serving the four endpoints the [website](../website) expects,
backed by Postgres via Prisma (`prisma/schema.prisma`). Every request is resolved to a tenant by
its `Host` header (see `services/*.js` and the `Tenant` model) — requests with no hostname or a
raw IP address are rejected before reaching any route. Frame/accessory photos live in
`public/images/`; photos uploaded by shops are stored outside the app folder (see Image uploads below).

## Running it

```bash
npm install
npx prisma generate         # regenerate the client after installing or after a schema change
npm start                   # http://localhost:4000
npm run dev                 # same, restarts on file changes
```

Needs a real `DATABASE_URL` in `.env` pointing at a reachable Postgres database, and that
database's tables created via `npx prisma migrate dev` (local) or `npx prisma migrate deploy`
(production — see `deploy/README.md`).

The website talks to this at `http://localhost:4000` in dev (see `website/.env.development`) — run
both together.

## Endpoints

- `GET /api/catalog` → `{ categories: { id, name, url }[], brands: { id, name }[] }` —
  `services/catalogService.js`. Categories are global; brands are filtered to the requesting
  tenant.
- `GET /api/frames?brandId=&categoryId=` → `{ code, name, brand, category, price?, currency?, images: string[], shape?, colors?, inStock }[]` (`images` are photo **codes**, see below)
  — `services/frameService.js` (400 if either query param is missing). Filtered to the requesting
  tenant. A frame goes out with its short **code** (unique per shop), never its internal id; a frame that has no code yet is not listed.
- `GET /api/frames/:code` → same shape as above, a single frame, found by its code within the requesting shop (the lookup is by shop and code: two shops can have the same code; the code is read in lowercase). 404 if not found — another
  tenant's frame is invisible to this tenant, so it 404s too. The internal id opens nothing. The website only calls it when an
  item's link is opened directly and the item wasn't already loaded in the browser.
- `GET /api/accessories` → `{ code, name, description, price?, currency?, images: string[], inStock }[]` (`images` are photo **codes**) —
  `services/accessoryService.js`. Filtered to the requesting tenant; an accessory goes out with its code, and one without a code is not listed.
- `GET /api/accessories/:code` → same shape as above, a single accessory, found by its code within the requesting shop. 404 if not found (or not
  this tenant's); used the same way as the frame one.
- `GET /api/infos` → `{ name, social: { label, url }[], contact: { address, phone, email } }` —
  `services/siteInfoService.js`. 404 if no tenant matches the requesting host.

## Photos in the API

`images` in the frame and accessory answers lists photo **codes only** (`["aviator-gold.jpg", "aviator-gold-2.jpg"]`),
never paths or addresses; a row that still stores an older path (`/images/frames/aviator.svg`) is
reduced to its last part (`aviator.svg`). The website works out the full address itself: its API
origin (empty when the backend serves the site) + `/images/<the host name it is served from>/<code>`
(`website/src/utils/imageUrl.ts`). The backend answers that address from the shop's folder (see
Image uploads) and also finds the older shared sample photos by code.

## Image uploads

A shop uploads a photo **of one of its frames or accessories**. The caller sends the image file as the
request body and identifies the shop with its **tenant key** (the `tenant.key` line of the desktop
app's config file). In the address, `code` is the **id of the frame or accessory** the photo is for and
`id` is the **id of the photo**, a UUID **made up by the client**; the request parameter `type` says
whether the code is a frame's or an accessory's:

```
POST /api/images/RB3025/3f6c1d7e-2b4a-4d8e-9a51-7c0e5b2a8f14?type=frame      (or ?type=accessory)
Authorization: Bearer <tenant key>
Content-Type: image/jpeg                     (any value; the type is read from the file itself)

201 { "id": "3f6c1d7e-…", "url": "/api/images/3f6c1d7e-…", "type": "frame", "code": "RB3025", "size": 48211, "contentType": "image/jpeg" }
```

What the server does, in this order:

1. **The tenant key must exist** in the `tenants` table. Missing, malformed or unknown → 401 (10 wrong
   keys from one address in 15 minutes → 429). This happens before the body is read.
2. **The request must be valid on its face**, without asking the database anything: `type` is `frame`
   or `accessory` (400), the code is a plain id of 1-100 letters, digits, dots, dashes or underscores
   starting with a letter or digit (400), the photo id is a UUID (400), and the body is a PNG, JPEG,
   WebP or GIF of at most 5 MB (`IMAGE_MAX_BYTES`; 415 for another type, SVG included, 413 for too
   large). The type is read from the file's first bytes, not from its name or `Content-Type`.
3. **The photo id must be new:** it is looked up in `product_images` (the id is its primary key). If it
   exists → 409, and nothing is inserted or overwritten.
4. **One query inserts the row, and its filter decides whether the product exists**
   (`lib/productImageStore.js`):
   `INSERT INTO product_images (id, tenant_key, frame_id) SELECT <id>, tenant_key, id FROM frames WHERE id = <code> AND tenant_key = <the tenant> RETURNING id`
   (`accessory_id` / `accessories` for `type=accessory`). The photo id the client sent becomes the
   row's primary key. There is no check for the product beforehand: if the shop has no such
   frame/accessory nothing is inserted and the answer is 404 (another shop's product with the same id
   matches nothing). If two requests race with the same new photo id, the primary key lets one
   through and the other is a 409 as well.
5. **The file is saved as `<IMAGES_DIR>/<id>.<type of the file>`**, named after the client's photo id (on
   Linux `IMAGES_DIR` defaults to **`/images`**; on Windows, for development, `public/images`). If
   saving fails the inserted row is deleted again, so no row points at a missing file and the id is
   free to retry.

Every upload **adds** a photo: a product can have several, each with its own id.

**Every failure is answered the same way**, so a client can tell what is wrong without reading
sentences, and a failed upload never leaves a row or a file behind:

```json
{ "error": "<what happened, in words>", "code": "<STABLE_CODE>", "...": "details" }
```

| Status | `code` | Meaning | Details / what to do |
|---|---|---|---|
| 401 | `UNAUTHORIZED` | no, malformed or unknown tenant key | `WWW-Authenticate: Bearer`; send `Authorization: Bearer <tenant key>` |
| 429 | `TOO_MANY_ATTEMPTS` | 10 wrong keys from this address | `retry: "after-delay"`, `retryAfterSeconds`, `Retry-After` header |
| 400 | `INVALID_TYPE` | `type` missing or not exactly `frame` / `accessory` | `allowed: ["frame","accessory"]` |
| 400 | `INVALID_PRODUCT_ID` | (delete a frame/accessory) the code is not a plain id | |
| 400 | `INVALID_CODE` | the product code is not a plain id | |
| 400 | `INVALID_PHOTO_ID` | the photo id is not a UUID | |
| 400 | `MALFORMED_ADDRESS` | broken percent-escape in the address | |
| 400 | `EMPTY_BODY` | no image in the body | |
| 400 | `BAD_ENCODED_BODY` | body says it is gzip/deflate/br but cannot be decoded | |
| 400 | `BAD_REQUEST_BODY` | the body was cut off | `retry: "same-request"` |
| 415 | `UNSUPPORTED_IMAGE` | not a PNG, JPEG, WebP or GIF (read from the bytes) | `allowed: [mime types]` |
| 415 | `UNSUPPORTED_ENCODING` | unknown `Content-Encoding` | |
| 413 | `IMAGE_TOO_LARGE` | over the limit | `maxBytes` |
| 404 | `PHOTO_NOT_FOUND` | (delete) this shop has no photo with this id | `id` |
| 404 | `PRODUCT_NOT_FOUND` | this shop has no such frame/accessory | `productType`, `productCode` |
| 404 | `WRONG_ADDRESS` | the photo id is missing from the address | `expected: "POST /api/images/{code}/{id}?type=frame\|accessory"` |
| 405 | `METHOD_NOT_ALLOWED` | not a POST | `Allow: POST` |
| 409 | `IN_USE` | (table API delete) other records still refer to it; nothing was deleted | |
| **409** | **`PHOTO_ID_EXISTS`** | **a photo with this id already exists; nothing was stored or overwritten** | **`id`, `retry: "new-id"`: make up another photo id and send the request again** |
| 500 | `SAVE_FAILED` | the file could not be saved (the row was removed again) | `retry: "same-request"` |
| 500 | `FILE_REMOVAL_FAILED` | (delete) the record was deleted but its file could not be removed from the disk | `id`, `recordDeleted: true`; contact the server's administrator with the id |
| 500 | `SERVER_ERROR` | an unexpected problem on the server | `retry: "same-request"` |

**Deleting a frame or an accessory** goes through the table API: `POST /api/table/frames?action=delete` (or `accessories`) with the
condition as the body, e.g. `{ "id": "<code>" }` (`lib/tableApi.js`, `lib/tableCore.js`). In one statement the ids of ALL the photos of the
matching products are fetched and the products are deleted (their photo rows go with them: the foreign key cascades). Only after that
succeeded are the photos' files removed, one by one; a file that cannot be removed is reported (500 `FILE_REMOVAL_FAILED`,
`recordDeleted: true`) while the others are still removed. Deleting photo rows (`product_images`) removes their files the same way.

```
200 { "table": "frames", "action": "delete", "count": 1, "photos": { "deleted": 3, "filesRemoved": 3 } }
500 FILE_REMOVAL_FAILED { ..., "recordDeleted": true, "photos": { "deleted": 3, "filesRemoved": 2, "filesFailed": ["<photo id>"] } }
```

A file with no row behind it is never deleted. The backend's role needs `DELETE` on `frames` and
`accessories` for this (and `SELECT`, which it has).

**Deleting a photo:** `DELETE /api/images/<id>` with `Authorization: Bearer <tenant key>` (the same
path as the download and the upload, told apart by the method).

1. The tenant key must exist (401 otherwise) and the id must be a UUID (400 `INVALID_PHOTO_ID`).
2. **One statement deletes the row:** `DELETE FROM product_images WHERE id = <id> AND tenant_key = <the key sent> RETURNING id`.
   Another shop's photo matches nothing, so it is left alone and the answer is 404 `PHOTO_NOT_FOUND`
   (the same answer as for an id that never existed).
3. **Only if a row was deleted** the file is removed from the disk (`<IMAGES_DIR>/<id>.png|.jpg|.webp|.gif`,
   or a file named by the bare id). A file with no row behind it is never deleted: nothing proves it is
   the caller's.

```
200 { "id": "<id>", "deleted": true, "fileRemoved": true }       (fileRemoved is false when the row had no file)
```

Deleting the same photo again is a 404. After a delete the photo id is free again. If the file cannot
be removed after the row was deleted, the answer is `500 FILE_REMOVAL_FAILED` with `recordDeleted: true`
(and the server logs it): the photo no longer exists for the shop, but a file is left on the disk.
Deleting a frame or accessory deletes its photo rows (cascade) but not their files.

Failures of `GET /api/images/<id>` are `404 { "error": ..., "code": "IMAGE_NOT_FOUND" }` (unknown id, an id
that is not a UUID, or a row whose file is missing).

- **Reading a photo:** `GET /api/images/<id>` (public, no authentication; the same path as the upload,
  told apart by the method) looks for `<IMAGES_DIR>/<id>` (also `<id>.png`, `.jpg`, `.webp`, `.gif`) and
  sends it, or answers 404. The id must be a UUID (anything else is a 404, so nothing but a plain file
  name is ever looked up), a file that isn't an image is never sent, and a folder with that name is not
  sent. Files are cached for a day.
- **Where the ids are listed:** every frame and accessory answer carries `imageIds`: the ids of its
  `product_images` rows, read in the same query as the product as a join (Prisma model `ProductImage`,
  `relationLoadStrategy: 'join'`, which needs the `relationJoins` preview feature set in the schema's
  generator), only rows of the tenant found from the request's host.
- **Older address:** `GET /images/<host name>/<code>` (the shop's host name, never its key) still
  serves files kept in a folder per shop (`<IMAGES_DIR>/<tenant key>/<code>`) and the older sample
  photos in `public/images/`. New uploads do not go there any more.
- **Needs from the database** for the backend's role: `SELECT` on `tenants`, `SELECT` on
  `product_images` (the `imageIds` join), and `INSERT` + `DELETE` on `product_images` plus `SELECT` on
  `frames` and `accessories` for uploads.

On the server, create the folder once and let the service user own it:

```bash
sudo mkdir -p /images && sudo chown REPLACE_WITH_SERVICE_USER: /images && sudo chmod 755 /images
```

## Tenant isolation (row-level security)

`brands`, `frames` and `accessories` — the tenant-owned tables this API reads — are isolated per
tenant by Postgres RLS, not by filters in the queries. Every query on them runs through
`withTenant(tenantKey, tx => …)` (`lib/tenantContext.js`), which opens a transaction and sets the
transaction-local setting `app.tenant_key` that the policies compare each row's `tenant_key`
against. The key comes from the request's host (`resolveTenantKeyByHost`). With the setting unset
or wrong, Postgres returns no rows.

**The policies and grants are set up by one script, `prisma/permissions.sql`, run once as the table
owner** (e.g. the Neon SQL editor — the backend's own role can't). It covers every tenant-owned
table in the database, including ones this API doesn't touch; the backend itself only ever needs
`SELECT`. It never grants `TRUNCATE` (which bypasses RLS) or any write on `categories`/`tenants`.
It's idempotent, runs as a single transaction, and ends with a table showing the result.

Until it's run nothing enforces isolation (and a role without grants can't read anything), and the
server logs a warning at startup saying so; it also warns if its role owns the tables or bypasses
RLS, in which case the policies would silently not apply. `categories` (global) and `tenants` (the
registry, read before any tenant is known) have no policy on purpose.

See `website/README.md`'s per-endpoint sections for the full field reference and rationale — the
shapes here match it exactly. `images` values on frames and accessories are relative paths
(e.g. `/images/frames/aviator.svg`) served from `public/images/` by this same server —
`Category.url` values are absolute Unsplash URLs instead, so they work regardless of origin.

## Serving the frontend build

`resources/dist/` holds the website's production build (`dist`, copied in as-is) and is
served as a single-page app — it's empty right now (see `resources/README.md` for how to populate
it), but the routing is already in place:

- `GET /` → `resources/dist/index.html`.
- `GET /assets/<path>` (or any other real file under `resources/dist/`, e.g. `/images/hero.svg`) →
  that exact file, served by `express.static`.
- Anything else unmatched — a missing asset, an unknown path, a client-side route — falls back to
  `resources/dist/index.html` with the correct `Content-Type`, so deep links and client-side
  routing resolve instead of a bare 404. Before a build exists, that fallback itself 404s with a
  plain-text "not deployed yet" message rather than crashing.
