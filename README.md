# OptiPro

Shop management for opticians: a **Windows desktop app** (Electron) that keeps working without internet, a **public website** for each shop that shows its frames and accessories, and a **server** that connects the two. Built for shops in Algeria (prices in DZD; the app speaks **English, French and Arabic**, with right-to-left layout for Arabic).

```
 ┌───────────────────────────┐        HTTPS (table API)        ┌──────────────────────────────┐
 │  Desktop app  (Electron)  │ ─────────────────────────────▶ │  Server                       │
 │  SQLite on the shop's PC  │   rows go up when online        │  Cloudflare Pages + Worker    │
 │  works offline            │ ◀───────────────────────────── │  (or the Express backend)     │
 └───────────────────────────┘      photos, deletions          │  ↕ Neon Postgres  ↕ R2 photos │
                                                               └──────────────┬───────────────┘
                                                                              │ /api/…
                                                                  ┌───────────▼────────────┐
                                                                  │  Website (React)       │
                                                                  │  one per shop (by host)│
                                                                  └────────────────────────┘
```

## What is in this repository

| Folder | What it is |
|---|---|
| `src/`, `renderer/`, `prisma/sqlite/` | **The desktop app.** `src/` is the Electron main process (TypeScript): local database, sync, IPC, label printing. `renderer/` is the window (plain JS/HTML/CSS, no framework). `prisma/sqlite/schema.prisma` is the local database. |
| `website/` | **The shop's public website** (React + TypeScript + Vite + Tailwind). Browse frames by category and brand, see accessories, open a product by its code. French/English. |
| `cloudflare/` | **The server, serverless version** (recommended). One Cloudflare Pages project: the built website + a Worker (`_worker.js`) that is the API. |
| `backend/` | **The server, classic version.** The same API as an Express app on Node, with Prisma and Postgres. |
| `scripts/` | Build helpers (generate the local database, check the sync order, generate the table-API column lists, make the demo icon, extract the texts to translate). |
| `tests/` | Automated tests (labels, orders, payments, order page, languages). |
| `build/` | The app's icon. |

### Backend vs Cloudflare: what is the difference?

They are **two implementations of the same server API**: the same addresses, the same answers, the same error codes. The website and the desktop app work with either one without any change. You run **one** of them, not both.

| | `cloudflare/` (recommended) | `backend/` |
|---|---|---|
| Runs on | Cloudflare Pages (serverless Worker, in Cloudflare's network) | Any machine that runs Node.js (a VPS, a PC) |
| Database access | Neon over **HTTP** (`@neondatabase/serverless`), no Prisma | Postgres over TCP through **Prisma** |
| Photos | **R2** bucket (object storage) | A folder on the server's disk |
| Website | Served by Pages from the same project | Served by Express (`public/` or the build), or hosted elsewhere |
| HTTPS / domains | Handled by Cloudflare (free, custom domains in the dashboard) | You set up the certificate and a reverse proxy |
| Cost / upkeep | Near zero, nothing to patch | A server to rent, update and keep running |
| Scaling | Automatic | You |

Why both exist: the Express backend came first and is the easiest to read and debug locally; the Worker was written afterwards so a shop can be hosted for free with no server to maintain. The table API that receives the desktop app's rows (`POST /api/table/<name>?action=insert|update|delete`) exists in both, and its list of columns is **generated from the local schema** so the two cannot drift (`npm run sync:table-api`, checked by `npm run check:table-api`).

## What the desktop app does today

- **Customers**: records, delete rules (no delete when prescriptions, orders, payments or invoices exist), history.
- **Prescriptions**: per customer, right/left eye, add, PD, doctor; a prescription used by an order is frozen.
- **Inventory**: frames (category → brand), accessories, **lenses** (design, material, index, power interval it can be made for, lead time, minimum fitting height, price). Photos per product. Every frame and accessory gets a short unique **code** like `abc-123`.
- **QR labels**: print a QR code (the product's address on the shop website) with its code below, sized to the label (default 40 × 25 mm), to a label printer; scanning a code in the order form finds the product.
- **Orders**: list with status filter, search, and a day/month/year period; an **order page** with customer, items, payments, left to pay, status switching (confirmed, at the lab, ready, delivered, cancelled) and payment taking.
- **Payments**: only the money that really came in (a cheque dated in the future is not shown until its day).
- **Dashboard**: money received today, orders by stage, late orders, cheques due, low stock, sales of the last days.
- **Three languages** (English, French, Arabic, right to left), chosen from the profile menu.
- **Offline first + sync**: everything is saved on the PC first and sent to the server when it can be reached.

Not built yet: placing an order (the *New order* form is UI only), invoices and receipts, suppliers, reports, settings, login and roles, backups, licence/activation, data import.

## How the data flows

1. The app stores everything in a **SQLite** file on the shop's PC (`%APPDATA%\OptiPro\local.db`). Every row has a UUID made on the PC and a local `synced` flag.
2. A scheduler (every 10 minutes, and after changes) sends unsent rows to the server's **table API**, parents before children, deletions first. The request carries the shop's **tenant key** as a bearer token. The server accepts an insert as an upsert by id.
3. The server stores rows in **Neon Postgres**. Each shop has its own database login (`tenant_<key>`) and **row-level security** so a shop only ever sees its own rows.
4. The **website** is found by the request's host name (`tenants.host`), reads the shop's frames and accessories through `/api/…`, and shows photos from R2 (or the server's folder). A product is opened by its code, never by its internal id.

## Requirements

- **Windows 10/11 x64** (the installer and the label printing are Windows-oriented; the app code itself is cross-platform Electron).
- **Node.js 24** and npm. Native modules (`better-sqlite3`) are built for Electron by the install scripts.
- For the server: a **Neon** (Postgres) database and a **Cloudflare** account (or a Node host for `backend/`).

## Build and run

### 1. The desktop app

```bash
npm install
npm start          # builds (tsc, local database client) and opens the app
```

`npm start` runs `npm run build` first: it generates the local database client from `prisma/sqlite/schema.prisma`, compiles `src/` to `dist/`, copies the client and checks the sync order. The window itself (`renderer/`) needs no build.

Settings live in `%APPDATA%\OptiPro\config.properties`. **Nothing is built into the app**: a new installation has no such file, and while it is missing (or has no `tenant.key` or no `server.url`) the app does not start: it opens a **setup page** instead (a form for the shop's key, server address and details; Confirm does nothing yet, so for now create the file by hand):

```properties
tenant.key=<the shop's key>            # identifies the shop to the server
server.url=https://your-shop.pages.dev # the server's address, https://, no trailing slash
label.width=40                         # optional: label width in mm (10-200)
label.height=25                        # optional: label height in mm
label.printer=                         # optional: printer name; empty = the print dialog opens
```

Useful environment variables: `OPTIPRO_CONFIG_FILE` (another settings file), `SQLITE_DATABASE_URL` (another database file), `OPTIPRO_IMAGES_DIR` (photos folder).

Make the Windows installer:

```bash
npm run dist       # build + checks + installer in release/OptiPro-Setup-<version>.exe
npm run pack       # same, but an unpacked folder (faster, to try)
```

The installer carries no shop settings and no secret: every installation is configured on its first run.

### 2. The server: Cloudflare (recommended)

```bash
cd cloudflare
npm install
npm run build:site            # builds ../website, then dist/ (the Worker + the site)
npx wrangler login
npx wrangler r2 bucket create optician-images
npx wrangler pages project create optician --production-branch main
npx wrangler pages deploy dist --project-name optician
npx wrangler pages secret put DATABASE_URL --project-name optician   # the Neon connection string of the `backend` role
```

Try it locally with `npm run dev` after creating `.dev.vars` (`DATABASE_URL=…`, `DEV_HOST=<a shop's host>`). Full details: [`cloudflare/README.md`](cloudflare/README.md).

### 2b. The server: Express backend (alternative)

```bash
cd backend
npm install
npx prisma generate
# .env: DATABASE_URL="postgresql://…"   (and IMAGES_DIR, PORT if needed)
npm start          # http://localhost:4000      (npm run dev restarts on changes)
```

Full details: [`backend/README.md`](backend/README.md).

### 3. The website

```bash
cd website
npm install
npm run dev        # http://localhost:5173, talks to the API in .env.development (http://localhost:4000)
npm run build      # production build (the Cloudflare build runs this for you)
```

### 4. The database (Neon)

`backend/prisma/schema.prisma` describes the tables the **website** reads (tenants, categories, brands, frames, accessories, product images); `npx prisma db push` from `backend/` creates them. The tables the desktop app syncs beyond those (customers, prescriptions, lenses, orders, order items, payments, invoices, number sequences) are the ones in `prisma/sqlite/schema.prisma`, and **on Neon they were created by hand with SQL**: there is no migration for them in this repository yet, so a brand-new Neon database needs those tables created to match the local schema before the app can sync them (a known gap). To add a shop, run `backend/prisma/create_tenant.sql` once (it defines `create_tenant()`), then:

```sql
SELECT create_tenant('shop.example.com', '<neon-host>');
```

It registers the shop, creates its own database login and row-level-security policies, and returns the connection URL. The shop's **key** goes in the app's `tenant.key`, and its **host** must be the address the site is served from. Treat the key and the URL as secrets.

## Tests

```bash
npm run build      # the tests use the compiled app in dist/
npm test           # all test files
npm test -- orders # only the files whose name contains "orders"
```

The window tests start the real app in a temporary folder with its own database, drive it, and check what it shows. The printing tests decode the QR codes they draw at 203/300 dpi to prove they scan. The dictionary test checks that every text the pages are written with has a French and an Arabic translation. Other checks: `npm run check:table-api` (generated column lists up to date), `npm run check:sync-parents` (sync order matches the schema).

## Languages

Texts are written in English in the pages; `renderer/i18n.js` translates what lands on the screen using `renderer/i18n/fr.js` and `ar.js` (English text → translation, with `{0}` holes for values). To add a language, add a dictionary file and register it. `node scripts/i18n-extract.mjs` lists every English text found in the pages.

## Good to know

- **Secrets**: every `.env`, `.dev.vars` and the local database are git-ignored. Never commit a tenant key or a connection string.
- **Money** is stored as whole centimes. A cancelled order owes nothing; an order can be paid in parts.
- **Rows that must never be deleted** (orders, payments, invoices and their numbering) are not deletable by a shop's database login: cancel or void them with a status.
- **After a schema change** in `prisma/sqlite/schema.prisma`: `npm run build` (regenerates the client) then `npm run sync:table-api`, and apply the matching change to the Neon tables.
