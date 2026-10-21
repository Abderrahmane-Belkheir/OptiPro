import cors from 'cors';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createImageByIdHandler, createImageFileRouter, createImageRouter, IMAGES_URL_PREFIX, removePhotoFiles } from './lib/imageUpload.js';
import { createTableApiRouter } from './lib/tableApi.js';
import { deleteProductImage, insertProductImage, productImageExists } from './lib/productImageStore.js';
import { prisma } from './lib/prismaClient.js';
import { resolveTenantKeyByHost, warnIfRlsDisabled, withTenant } from './lib/tenantContext.js';
import { getAccessories, getAccessoryByCode } from './services/accessoryService.js';
import { getCatalog } from './services/catalogService.js';
import { getFrameByCode, getFrames } from './services/frameService.js';
import { getSiteInfo } from './services/siteInfoService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const resourcesDir = path.join(__dirname, '..', 'resources', 'dist');

// Where uploaded photos are stored: directly in <IMAGES_DIR>, named by the id of their product_images row
// (<IMAGES_DIR>/<id>.<type>), the same for every shop. On
// Linux that is /images (outside the app folder, so deploying a new version never touches the
// photos); the service user must own it — see deploy/README.md. Windows has no such folder, so
// local development keeps them under public/images instead.
const imagesDir = process.env.IMAGES_DIR || (process.platform === 'win32' ? path.join(publicDir, 'images') : '/images');

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

// POST /api/images/<code>/<id>?type=frame|accessory -> { id, url, type, code, size, contentType }
// A shop uploads a photo for one of its frames or accessories: <code> is that product's id, <id> the
// photo's id (a UUID the client makes up). Authenticated with the shop's tenant key (Authorization:
// Bearer <key>), which must exist in the tenants table; the photo id must not exist yet in
// product_images; then one INSERT … SELECT, filtered by tenant and product id, inserts the row with that
// id as its primary key (404 when the shop has no such product); the file is saved as <imagesDir>/<id>.
// See lib/imageUpload.js.
// DELETE /api/images/<id> (same router): deletes the photo's product_images row (filtered by the tenant key
// that was sent) and, only if a row was deleted, its file from the disk.
app.use(
  '/api/images',
  createImageRouter({
    imagesDir,
    findTenantByKey: (key) => prisma.tenant.findUnique({ where: { key }, select: { key: true } }),
    productImageExists,
    insertProductImage,
    deleteProductImage,
  }),
);

// POST /api/table/<name>?action=insert|update|delete (Authorization: Bearer <tenant key>): the table API the desktop app
// writes its rows through. It checks the key, the table and the action (the map in lib/tableApi.js), reads the JSON body and
// has lib/tableCore.js validate it and write the rows (every statement runs as that shop, see withTenant). Deleting a frame or an
// accessory (or a photo row) also removes its photos' files from the images folder.
app.use(
  '/api/table',
  createTableApiRouter({
    findTenantByKey: (key) => prisma.tenant.findUnique({ where: { key }, select: { key: true } }),
    runQuery: (tenantKey, text, params) => withTenant(tenantKey, (tx) => tx.$queryRawUnsafe(text, ...params)),
    removeFiles: async (photoIds) => {
      const failed = [];
      for (const id of photoIds) {
        try {
          await removePhotoFiles(imagesDir, id);
        } catch (err) {
          console.error(`Photo ${id}: its row was deleted but its file could not be removed:`, err.message);
          failed.push(id);
        }
      }
      return failed;
    },
  }),
);

// GET /api/catalog -> { categories: { id, name, url }[], brands: { id, name }[] }
app.get('/api/catalog', async (req, res) => {
  res.json(await getCatalog(req.hostname));
});

// GET /api/frames?brandId=&categoryId= -> { code, name, brand, category, price?, currency?, images: string[] (photo CODES), imageIds: string[], shape?, colors?, inStock }[]
app.get('/api/frames', async (req, res) => {
  const { brandId, categoryId } = req.query;
  if (!brandId || !categoryId) {
    res.status(400).json({ error: 'Both "brandId" and "categoryId" query params are required.' });
    return;
  }
  res.json(await getFrames({ host: req.hostname, brandId, categoryId }));
});

// GET /api/frames/:code -> { code, name, brand, category, price?, currency?, images: string[] (photo CODES), imageIds: string[], shape?, colors?, inStock } (404 if not found)
// A frame is known by its code, unique within the shop (the host's shop: two shops can have the same code), never by its internal id.
// Only needed when a frame's link is opened directly, before the list that contains it was loaded.
app.get('/api/frames/:code', async (req, res) => {
  const frame = await getFrameByCode(req.hostname, req.params.code);
  if (!frame) {
    res.status(404).json({ error: `No frame with the code "${req.params.code}" found.` });
    return;
  }
  res.json(frame);
});

// GET /api/accessories -> { code, name, description, price?, currency?, images: string[] (photo CODES), imageIds: string[], inStock }[]
app.get('/api/accessories', async (req, res) => {
  res.json(await getAccessories(req.hostname));
});

// GET /api/accessories/:code -> { code, name, description, price?, currency?, images: string[] (photo CODES), imageIds: string[], inStock } (404 if not found)
// An accessory is known by its code, unique within the host's shop, never by its internal id.
// Only needed when an accessory's link is opened directly, before the list that contains it was loaded.
app.get('/api/accessories/:code', async (req, res) => {
  const accessory = await getAccessoryByCode(req.hostname, req.params.code);
  if (!accessory) {
    res.status(404).json({ error: `No accessory with the code "${req.params.code}" found.` });
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

// GET /api/images/:id -> a photo by its id (the ids come in `imageIds` of every frame and accessory). The
// upload is the same path with POST and a code (POST /api/images/:code, above). Public. The photos for it
// live directly in the images folder, the same for every shop: <imagesDir>/<id>. If such a file exists it
// is sent, otherwise 404. See lib/imageUpload.js.
app.get('/api/images/:id', createImageByIdHandler({ imagesDir }));

// GET /images/<host>/<code> -> the photo uploaded under that code (code with or without its
// extension) by the shop whose host name that is. Public, no authentication; the address carries the
// host, never the tenant key (the shop's upload credential): the key is looked up in the tenants
// table and the file read from <imagesDir>/<tenant key>/<code>. See lib/imageUpload.js. Anything it
// doesn't recognise (the older photos laid out as public/images/frames/aviator.svg, the website's
// own images) falls through to the static folders below.
app.use(IMAGES_URL_PREFIX, createImageFileRouter({
    imagesDir,
    findKeyByHost: resolveTenantKeyByHost,
    legacyDirs: [path.join(publicDir, 'images', 'frames'), path.join(publicDir, 'images', 'accessories')],
  }));

// Serves this API's own assets (the older frame/accessory photos referenced by /images/... paths
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
// before it. Anything that reaches it is logged server-side and answered with a generic 500, never
// leaking internals.
app.use((err, _req, res, _next) => {
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
