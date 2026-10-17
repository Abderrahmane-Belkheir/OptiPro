import cors from 'cors';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authorize } from './lib/authorization.js';
import { warnIfRlsDisabled } from './lib/tenantContext.js';
import { getAccessories, getAccessoryById } from './services/accessoryService.js';
import { getCatalog } from './services/catalogService.js';
import { getFrameById, getFrames } from './services/frameService.js';
import { getSiteInfo } from './services/siteInfoService.js';
import { deleteRow, getTableNames, getTableRows, upsertRows, isWritable } from './services/tableService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const resourcesDir = path.join(__dirname, '..', 'resources', 'dist');

const app = express();
app.use(cors());

// Tenants are resolved by hostname (see services/*.js), so a request with no Host header or one
// that's a raw IP address (net.isIP returns 0 for non-IPs, 4 or 6 for an IPv4/IPv6 address) can
// never map to a tenant — reject it here instead of letting it fail deeper in each route.
// req.hostname keeps surrounding brackets for IPv6 (e.g. "[::1]"), which net.isIP doesn't
// recognize, so they're stripped before the check.
app.use((req, res, next) => {
  const bareHostname = req.hostname?.replace(/^\[|\]$/g, '');
  if (!bareHostname || net.isIP(bareHostname) !== 0) {
    res.status(400).json({ error: 'Requests must use a valid hostname, not an IP address.' });
    return;
  }
  next();
});

// GET /api/catalog -> { categories: { id, name, url }[], brands: { id, name }[] }
app.get('/api/catalog', async (req, res) => {
  res.json(await getCatalog(req.hostname));
});

// GET /api/frames?brandId=&categoryId= -> { id, name, brand, category, price?, currency?, images: string[], shape?, colors?, inStock }[]
app.get('/api/frames', async (req, res) => {
  const { brandId, categoryId } = req.query;
  if (!brandId || !categoryId) {
    res.status(400).json({ error: 'Both "brandId" and "categoryId" query params are required.' });
    return;
  }
  res.json(await getFrames({ host: req.hostname, brandId, categoryId }));
});

// GET /api/frames/:id -> { id, name, brand, category, price?, currency?, images: string[], shape?, colors?, inStock } (404 if not found)
// Only needed when a frame's link is opened directly, before the list that contains it was loaded.
app.get('/api/frames/:id', async (req, res) => {
  const frame = await getFrameById(req.hostname, req.params.id);
  if (!frame) {
    res.status(404).json({ error: `No frame "${req.params.id}" found.` });
    return;
  }
  res.json(frame);
});

// GET /api/accessories -> { id, name, description, price?, currency?, images: string[], inStock }[]
app.get('/api/accessories', async (req, res) => {
  res.json(await getAccessories(req.hostname));
});

// GET /api/accessories/:id -> { id, name, description, price?, currency?, images: string[], inStock } (404 if not found)
// Only needed when an accessory's link is opened directly, before the list that contains it was loaded.
app.get('/api/accessories/:id', async (req, res) => {
  const accessory = await getAccessoryById(req.hostname, req.params.id);
  if (!accessory) {
    res.status(404).json({ error: `No accessory "${req.params.id}" found.` });
    return;
  }
  res.json(accessory);
});

// GET /api/infos -> { name, social: { label, url }[], contact: { address, phone, email } }
app.get('/api/infos', async (req, res) => {
  const siteInfo = await getSiteInfo(req.hostname);
  if (!siteInfo) {
    res.status(404).json({ error: `No tenant configured for host "${req.hostname}".` });
    return;
  }
  res.json(siteInfo);
});

// The Authorization header is the tenant's key. 404 (with code INVALID_TENANT_KEY, so the desktop
// client can tell it from a missing row) if it's missing, empty or no tenant has that key.
// Runs before anything else on the route — including body parsing and the table-name check — so an
// unauthenticated caller can neither probe which tables exist nor get a body-validation error.
// Tenant scoping comes from this key, never from the request's host.
const INVALID_TENANT_KEY = 'INVALID_TENANT_KEY';

async function requireTenantKey(req, res, next) {
  const authorization = req.headers.authorization;
  if (!authorization) {
    res.status(404).json({ error: 'Missing Authorization header.', code: INVALID_TENANT_KEY });
    return;
  }
  const tenantKey = await authorize(authorization);
  if (!tenantKey) {
    res.status(404).json({ error: 'Invalid Authorization key.', code: INVALID_TENANT_KEY });
    return;
  }
  req.tenantKey = tenantKey;
  next();
}

// GET /api/tables/:table -> every row of that table the tenant can see (404 if the table isn't one
// this app manages). Row visibility is Postgres row-level security, see lib/tenantContext.js.
app.get('/api/tables/:table', requireTenantKey, async (req, res) => {
  const rows = await getTableRows(req.tenantKey, req.params.table);
  if (!rows) {
    res.status(404).json({ error: `No table "${req.params.table}" available.` });
    return;
  }
  res.json(rows);
});

// POST /api/tables/:table -> upserts a row (JSON object) or several (JSON array, all-or-nothing)
// as the authorized tenant: a row whose id matches one of the tenant's rows updates it (only the
// fields sent), any other is inserted. Responds 201 with the saved row(s) when every row was new,
// 200 when at least one was an update. Only tenant-owned tables
// (brands, frames, accessories, customers): 405 for categories and tenants, 404 for anything else.
// 400/409 for bad or duplicate rows. The tenant of every row is forced to the key's; RLS is the
// backstop.
app.post('/api/tables/:table', requireTenantKey, express.json({ limit: '1mb' }), async (req, res) => {
  const { table } = req.params;
  if (!getTableNames().includes(table)) {
    res.status(404).json({ error: `No table "${table}" available.` });
    return;
  }
  if (!isWritable(table)) {
    res.set('Allow', 'GET').status(405).json({ error: `Table "${table}" is read-only.` });
    return;
  }
  const { rows, created } = await upsertRows(req.tenantKey, table, req.body);
  res.status(created ? 201 : 200).json(rows);
});

// DELETE /api/tables/:table/:id -> deletes that row and responds 204. Same table rules as POST
// (405 for categories/tenants, 404 for an unknown table). 404 if the tenant has no such row —
// RLS hides other tenants' rows, so someone else's id is a 404 too — and 409 if other rows still
// reference it (e.g. a brand that has frames).
app.delete('/api/tables/:table/:id', requireTenantKey, async (req, res) => {
  const { table, id } = req.params;
  if (!getTableNames().includes(table)) {
    res.status(404).json({ error: `No table "${table}" available.` });
    return;
  }
  if (!isWritable(table)) {
    res.set('Allow', 'GET').status(405).json({ error: `Table "${table}" is read-only.` });
    return;
  }
  if (!(await deleteRow(req.tenantKey, table, id))) {
    res.status(404).json({ error: `No row "${id}" in "${table}".` });
    return;
  }
  res.status(204).end();
});

// Serves this API's own assets (the frame/accessory photos referenced by /images/... paths
// above) from public/. Registered before the frontend build below so these resolve correctly
// regardless of whether a build has been deployed to resources/dist/ yet.
app.use(express.static(publicDir));

// Serves the website's production build once it's dropped into resources/dist/ (see
// resources/README.md): GET / resolves to resources/dist/index.html automatically
// (express.static's default `index` file), and GET /assets/<path> (or any other real path,
// e.g. /images/hero.svg) serves that exact file when present. Empty today, so this quietly
// matches nothing and every request falls through.
app.use(express.static(resourcesDir));

// Anything still unmatched — a missing asset, an unknown path, a client-side route with no
// server-side counterpart — falls back to the SPA shell instead of a bare 404, so deep links and
// client-side routing resolve correctly. Only applies to GET/HEAD; other methods still 404.
app.use((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(404).end();
    return;
  }

  res.sendFile(path.join(resourcesDir, 'index.html'), (err) => {
    if (err && !res.headersSent) {
      res
        .status(404)
        .type('text/plain')
        .send('Frontend build not deployed yet — see resources/README.md.');
    }
  });
});

// Catches errors thrown or rejected anywhere above (Express 5 forwards async route-handler
// rejections here automatically) — must be registered last so it sees errors from every route
// before it. Client errors that opted in with `expose` (bad JSON bodies, rejected insert rows) are
// passed through with their own status and message; anything else is logged server-side and
// answered with a generic 500, never leaking internals.
app.use((err, _req, res, _next) => {
  if (!res.headersSent && err.expose && err.status >= 400 && err.status < 500) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  if (res.headersSent) {
    return;
  }
  res.status(500).json({ error: 'Internal server error.' });
});

// Not awaited: it only logs, and must never hold up (or take down) startup.
warnIfRlsDisabled();

// With SSL_KEY_PATH/SSL_CERT_PATH set, Node terminates TLS itself — no nginx or other reverse
// proxy in front. A plain HTTP server still listens on HTTP_PORT (default 80), but only to serve
// certbot's ACME challenge files (for cert renewal) and 301-redirect everything else to HTTPS;
// it never serves real content. Without those env vars, falls back to plain HTTP on PORT, for
// local dev.
const { SSL_KEY_PATH, SSL_CERT_PATH, SSL_CA_PATH, ACME_WEBROOT_PATH } = process.env;

if (SSL_KEY_PATH && SSL_CERT_PATH) {
  const httpsOptions = {
    key: fs.readFileSync(SSL_KEY_PATH),
    cert: fs.readFileSync(SSL_CERT_PATH),
    ...(SSL_CA_PATH ? { ca: fs.readFileSync(SSL_CA_PATH) } : {}),
  };

  const HTTPS_PORT = process.env.HTTPS_PORT || 443;
  https.createServer(httpsOptions, app).listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`Optician backend listening on https://0.0.0.0:${HTTPS_PORT}`);
  });

  const redirectApp = express();
  if (ACME_WEBROOT_PATH) {
    redirectApp.use(
      '/.well-known/acme-challenge',
      express.static(path.join(ACME_WEBROOT_PATH, '.well-known', 'acme-challenge')),
    );
  }
  redirectApp.use((req, res) => {
    res.redirect(301, `https://${req.hostname}${req.url}`);
  });

  const HTTP_PORT = process.env.HTTP_PORT || 80;
  http.createServer(redirectApp).listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`HTTP->HTTPS redirect listening on http://0.0.0.0:${HTTP_PORT}`);
  });
} else {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Optician backend listening on http://localhost:${PORT} (no SSL_KEY_PATH/SSL_CERT_PATH set)`);
  });
}
