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

## Endpoints

- `GET /api/catalog` → `{ categories: { id, name, url }[], brands: { id, name }[] }` —
  `services/catalogService.js`. Categories are global; brands are filtered to the requesting
  tenant.
- `GET /api/frames?brandId=&categoryId=` → `{ id, name, brand, category, price?, currency?, images: string[], shape?, colors?, inStock }[]`
  — `services/frameService.js` (400 if either query param is missing). Filtered to the requesting
  tenant.
- `GET /api/accessories` → `{ id, name, description, price?, currency?, imageUrl, inStock }[]` —
  `services/accessoryService.js`. Filtered to the requesting tenant.
- `GET /api/infos` → `{ name, social: { label, url }[], contact: { address, phone, email } }` —
  `services/siteInfoService.js`. 404 if no tenant matches the requesting host.

See `website/README.md`'s per-endpoint sections for the full field reference and rationale — the
shapes here match it exactly. `images`/`imageUrl` values on frames and accessories are relative
paths (e.g. `/images/frames/aviator.svg`) served from `public/images/` by this same server —
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
