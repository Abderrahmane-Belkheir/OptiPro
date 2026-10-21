# Cloudflare Pages: the website and its API

`dist/` is the folder you upload to Cloudflare Pages. It holds

| In `dist/` | What it is |
|---|---|
| `index.html`, `assets/`, `images/` | the React website (built from `../website`) |
| `_worker.js` | the API, one file: the code in `src/` plus Neon's HTTP driver |
| `_routes.json` | only `/api/*` runs `_worker.js`; the website's files are served by Pages without running any code |
| `_headers` | how long browsers keep the website's files |

The API is the same as the old Express backend's (same addresses, same answers, same error codes), so the website and the
Electron app need no changes. Photos are kept in **R2**, the database is **Neon over HTTP** (no Prisma, no TCP connection).

## Deploy (first time)

```bash
cd cloudflare
npm install                                   # esbuild + Neon's driver (only needed to rebuild)

npx wrangler login
npx wrangler r2 bucket create optician-images # the photos
npx wrangler pages project create optician --production-branch main
npx wrangler pages deploy dist --project-name optician
npx wrangler pages secret put DATABASE_URL --project-name optician   # paste the Neon connection string of the `backend` role
```

If you upload `dist/` in the Cloudflare dashboard instead (Workers & Pages > Create > Pages > Upload assets), bind the
bucket and the secret there: *Settings > Bindings > R2 bucket*: variable name `IMAGES`, bucket `optician-images`;
*Settings > Variables and Secrets*: `DATABASE_URL`. (`wrangler.toml` already declares the binding for `wrangler pages deploy`.)
After adding a binding or a secret, deploy once more.

## Shops and their addresses
A shop is found from the **host name** of the request, so `tenants.host` in the database must be the address the site is
served from, for example `eurl-optician.pages.dev` or the shop's own domain (add it in *Custom domains*). The Electron app's
`server.url` in `config.properties` is that same address (`https://...`, a host name, never an IP address).

## Rebuild after changing the website or `src/`
```bash
npm run build:site     # builds ../website, then dist/
npm run build          # dist/ only (the website unchanged)
npx wrangler pages deploy dist --project-name optician
```

## Try it on your computer
Create `.dev.vars` (never commit it):
```
DATABASE_URL=<the backend role's connection string>
DEV_HOST=<a shop's host name from the tenants table>
```
then `npm run dev` and open http://localhost:8788. `DEV_HOST` stands in for the shop's host name, because `localhost` is not a shop. Never set it on the deployed project.

## The API
| | |
|---|---|
| `GET /api/catalog` | categories and the shop's brands |
| `GET /api/frames?brandId=&categoryId=` | frames; also `&limit=` (1-200, default `LIST_LIMIT`, 200) and `&cursor=` |
| `GET /api/frames/:code` | one frame, by its code (unique per shop); the id never goes out |
| `GET /api/accessories` | accessories; `?limit=` and `?cursor=` as above |
| `GET /api/accessories/:code` | one accessory, by its code |
| `GET /api/infos` | the shop's name, social links, contact |
| `GET /api/images/:id` | a photo (from R2); public |
| `POST /api/images/:code/:id?type=frame\|accessory` | upload a photo (`Authorization: Bearer <tenant key>`, body = the file, at most 5 MB) |
| `DELETE /api/images/:id` | delete a photo (tenant key) |
| `POST /api/table/:name?action=insert\|update\|delete` | the table API (tenant key): deleting a frame or an accessory (or a photo row) also removes its photos' files from R2 |

**Lists are paged.** A list answers at most `LIST_LIMIT` items (200). `X-Total-Count` says how many there are in all and
`X-Next-Cursor` (absent on the last page) is the `cursor` to send for the next page. A client that ignores the headers sees
the first page only.

Errors are `{ "error": "...", "code": "STABLE_CODE", ... }`, with `retry` when sending again can help (see `src/http.js`).

## Settings (`wrangler.toml` > `[vars]`, or the dashboard)
`LIST_LIMIT` (200) · `CACHE_SECONDS` (30: how long Cloudflare keeps an answer for the website before asking Neon again, so a change
can take that long to show) · `IMAGE_MAX_BYTES` (5 MB) · `DEV_HOST` (local testing only).

## What the database role needs
The `DATABASE_URL` role must be able to: `SELECT` on `tenants`, `categories`, `brands`, `frames`, `accessories`, `product_images`;
`INSERT` and `DELETE` on `product_images`; `DELETE` on `frames` and `accessories`. It needs **no** `UPDATE` (the delete is one
statement and takes no row lock).

`create_tenant()` (backend/prisma/create_tenant.sql) makes exactly such a login for every new shop, named `backend_tenant_<key>` with the
tenant key as its password: it does **not** bypass row-level security, has only those privileges, and each is limited by a policy to
the shop's own rows (including its own row of `tenants`). `SELECT * FROM create_tenant(...)` answers its URL as `backend_url`; use it as
this project's `DATABASE_URL`, so even a bug in the Worker cannot read another shop. For a shop that already exists:
`SELECT create_backend_role('<tenant key>', '<server address>')` (safe to run again).

## Things to know
- **CPU on the free plan is 10 ms per request.** Every request is one HTTP call to Neon, which keeps the Worker's own work small, but
  the real figures come from Cloudflare: after deploying, read the *CPU time* P50/P99 in the Worker's metrics (Workers & Pages >
  your project > Metrics) and `npx wrangler pages deployment tail` for any `exceededCpu`. If a route is over, the $5 plan raises the limit.
- **The wrong-key limiter is per running copy of the Worker** (10 wrong keys per address in 15 minutes). Cloudflare may run several
  copies, so treat it as a brake; add a Cloudflare rate-limiting rule on `POST` and `DELETE` `/api/*` for a hard limit.
- **Old photo addresses** (`/images/<host>/<code>`, from before photos had ids) are not served: photos are fetched by id, which is
  what the website and the app use. The sample pictures in `images/` are plain static files.
- A photo deleted from a product while an upload for the same product is running may leave an unreferenced file in the bucket.

## Photos straight from R2 (optional, saves Worker requests)
By default every photo view runs the Worker (`GET /api/images/<id>`), which counts against the free 100,000 requests a day.
To let the browser fetch photos from the bucket itself, while uploads and deletes still go through the Worker (key check, image check):

1. In the dashboard open **R2 > optician-images > Settings > Public access** and connect a **custom domain** (for example
   `photos.yourdomain.com`; the domain must be on Cloudflare). For a quick test you can enable the `r2.dev` address instead,
   but it is rate-limited and not meant for production.
2. Tell the website where the photos are: create `website/.env.production` with
   ```
   VITE_PHOTO_ORIGIN=https://photos.yourdomain.com
   ```
3. `npm run build:site`, then deploy as usual.

A photo is then `https://photos.yourdomain.com/images/<photo id>`: the Worker keeps every photo in the bucket under the key `images/<photo id>` (lower-case id, no file extension; the type is stored with the file). The Worker stores each photo under its id with its type and a one-day
cache setting, so the bucket serves it correctly by itself. Leave `VITE_PHOTO_ORIGIN` unset to keep fetching through the API.
Anyone with a photo's address can view it, as with `/api/images/<id>` (the ids are random UUIDs). A deleted photo can stay in
browsers and Cloudflare's cache for up to a day.
