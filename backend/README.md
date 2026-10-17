# Optician Backend

A small multi-tenant Express API serving the four endpoints the [website](../website) expects,
backed by Postgres via Prisma (`prisma/schema.prisma`). Every request is resolved to a tenant by
its `Host` header (see `services/*.js` and the `Tenant` model) — requests with no hostname or a
raw IP address are rejected before reaching any route. Frame/accessory photos live in
`public/images/`.

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

`npm run seed` (with the server running) inserts sample brands, frames, accessories and customers
through `POST /api/tables/:table` as the tenant `maison-clair`, and `npm run seed:drop` deletes
exactly those rows again through `DELETE /api/tables/:table/:id` (customers, accessories, frames,
then brands — a brand can't go while a frame uses it). It only ever talks to the API — it never
connects to the database. Brands are matched by name (their id is a database serial), everything
else by a fixed id, so re-running either command skips what's already done. Frames need the
`categories` rows to exist already, since the API can't create them. Pass another key
(`npm run seed -- <key>`) or `API_URL=…` to aim it elsewhere. It's a dev helper and isn't part of
`deploy/`.

## Endpoints

- `GET /api/catalog` → `{ categories: { id, name, url }[], brands: { id, name }[] }` —
  `services/catalogService.js`. Categories are global; brands are filtered to the requesting
  tenant.
- `GET /api/frames?brandId=&categoryId=` → `{ id, name, brand, category, price?, currency?, images: string[], shape?, colors?, inStock }[]`
  — `services/frameService.js` (400 if either query param is missing). Filtered to the requesting
  tenant.
- `GET /api/frames/:id` → same shape as above, a single frame. 404 if not found — another
  tenant's id is invisible to this tenant (RLS), so it 404s too. The website only calls it when an
  item's link is opened directly and the item wasn't already loaded in the browser.
- `GET /api/accessories` → `{ id, name, description, price?, currency?, images: string[], inStock }[]` —
  `services/accessoryService.js`. Filtered to the requesting tenant.
- `GET /api/accessories/:id` → same shape as above, a single accessory. 404 if not found (or not
  this tenant's); used the same way as the frame one.
- `GET /api/infos` → `{ name, social: { label, url }[], contact: { address, phone, email } }` —
  `services/siteInfoService.js`. 404 if no tenant matches the requesting host.
- `GET /api/tables/:table` → every row of that table belonging to the tenant whose key is the
  `Authorization` header (bare key or `Bearer <key>`) — `services/tableService.js`. Scoping comes
  from that key, not the request's host, and is enforced by Postgres row-level security (below).
  `categories` is global and `tenants` always returns `[]` (it holds the keys). `404` with
  `code: "INVALID_TENANT_KEY"` if the header is missing or no tenant has that key
  (`lib/authorization.js`, checked before the table name so callers can't probe which tables
  exist; the desktop app shuts down on it), `404` if `:table` isn't in
  `prisma/schema.prisma`.
- `POST /api/tables/:table` → **upserts** a row (JSON object) or several (JSON array, up to 500,
  all-or-nothing) as the key's tenant: a row whose `id` is one of the tenant's rows updates it
  (only the fields sent change), any other row is inserted. Responds `201` with the saved row(s)
  when every row was new, `200` when at least one was an update. For `brands`, whose id is a
  database serial, send no `id` to insert and an `id` to update (`400` if the tenant has no such
  brand). Same
  `Authorization` key as the GET, checked before the body is parsed. Only tenant-owned tables
  (`brands`, `frames`, `accessories`, `customers`): `405` for `categories`/`tenants`, `404` for
  anything else.
  The tenant of every row is forced to the key's (a `tenantKey` in the body is ignored), a
  every reference to another tenant-owned table (a frame's brand, an order's customer and
  prescription, an order item's order/frame/lens/accessory, a payment's or invoice's order and
  customer, an invoice line's invoice) must be one of the tenant's own rows — Postgres skips RLS when
  checking foreign keys, so `TENANT_OWNED_REFERENCES` in `src/services/tableService.js` does it, and
  `npm run check:references` fails if that list drifts from `prisma/schema.prisma`. Unknown fields are rejected, and a bad
  row is `400`, a duplicate `409` (a new row whose id belongs to another tenant is a `409` too —
  it is never overwritten). **Needs `prisma/permissions.sql` run first** — until the backend's
  role has `INSERT`/`UPDATE`, every valid write is a `500`.
- `DELETE /api/tables/:table/:id` → deletes that row, `204`. Same key and table rules as the POST
  (`405` for `categories`/`tenants`, `404` for an unknown table). `404` if the tenant has no such
  row — RLS hides other tenants' rows, so someone else's id is a `404` too — `400` for a
  non-integer `brands` id, and `409` if other rows still reference it (a brand that has frames).
  Needs the `DELETE` grant from `prisma/permissions.sql`.

## Tenant isolation (row-level security)

`brands`, `frames`, `accessories` and `customers` are isolated per tenant by Postgres RLS, not by
filters in the queries. Every query on them runs through `withTenant(tenantKey, tx => …)`
(`lib/tenantContext.js`), which opens a transaction and sets the transaction-local setting
`app.tenant_key` that the policies compare each row's `tenant_key` against. Public routes get the
key from the request's host (`resolveTenantKeyByHost`); `/api/tables/:table` gets it from the
validated `Authorization` key. With the setting unset or wrong, Postgres returns no rows.

**All of it is set up by one script, `prisma/permissions.sql`, run once as the table owner**
(e.g. the Neon SQL editor — the backend's own role can't). Set the role from `DATABASE_URL` on the
`set_config` line at the top first. It creates the `customers` table if it's missing, adds the
columns added to older tables, checks the shop-management tables exist (prescriptions, lenses,
orders, order_items, payments, invoices, invoice_items, number_sequences — create them from
`prisma/schema.prisma` first), grants the backend's role `SELECT` on every table,
`INSERT`/`UPDATE`/`DELETE` on the twelve tenant-owned ones (under RLS, so only the tenant's own
rows) and the `brands` id sequence, and enables the RLS policies. It never grants `TRUNCATE` (which bypasses RLS) or any
write on `categories`/`tenants`. It's idempotent, runs as a single transaction, and ends with a
table showing the result.

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
