// The Worker of the Cloudflare Pages project (built into dist/_worker.js). Only /api/* reaches it (see _routes.json);
// everything else is the website's static files, which Pages serves by itself without running any code.
//
//   GET    /api/catalog                          categories + the shop's brands
//   GET    /api/frames?brandId=&categoryId=      [&limit=&cursor=]   a page of frames, with X-Total-Count / X-Next-Cursor
//   GET    /api/frames/:code                       one frame, by its code (unique per shop; the id never goes out)
//   GET    /api/accessories                      [?limit=&cursor=]
//   GET    /api/accessories/:code                one accessory, by its code
//   GET    /api/infos                            the shop's name, social links, contact
//   GET    /api/images/:id                       a photo (from R2)
//   POST   /api/images/:code/:id?type=frame|accessory     upload a photo           (Authorization: Bearer <tenant key>)
//   DELETE /api/images/:id                                delete a photo           (same)
//   POST   /api/register                                  the shop sends its information; the tenants row is updated (Authorization: Bearer <tenant key>, which must exist and not be expired)
//   POST   /api/infos                                     (same address) a registered shop sends its information again; the fields that have a value update the tenants row (Authorization: Bearer <tenant key>, whose licence must be running)
//   GET    /api/expiry                                    the day the shop's licence ends: { expiry: "YYYY-MM-DD" } (Authorization: Bearer <tenant key>; 401 UNAUTHORIZED for an unknown, malformed, never registered or expired key)
//   GET    /api/orders/:tracking_id                       follow an order with its 6-digit tracking code (public; the shop is the host): status, dates, totals, what is paid and what is left, lines, the shop's contact. Never the prescription.
//   POST   /api/table/:name?action=insert|update|delete   the table API: writes rows (same); deleting a frame or an accessory (or a photo row) also removes its photos' files from R2
//
// Bindings: DATABASE_URL (secret, Neon connection string), IMAGES (R2 bucket). Settings (optional): LIST_LIMIT,
// CACHE_SECONDS, IMAGE_MAX_BYTES, DEV_HOST (local testing only: stands in for the shop's host name).

import { neon } from '@neondatabase/serverless';
import { apiError, CORS, json } from './http.js';
import { isIpAddress } from './rules.js';
import { deletePhoto, getPhoto, uploadPhoto } from './photos.js';
import { tableRoute } from './tableApi.js';
import { registerRoute } from './register.js';
import { expiryRoute } from './expiry.js';
import { updateInfosRoute } from './infos.js';
import { trackRoute } from './track.js';
import { accessoriesRoute, accessoryRoute, catalogRoute, framesRoute, frameRoute, infosRoute } from './reads.js';

const METHODS_FOR = (allowed) => ({ Allow: allowed.join(', ') });

function defaultSql(env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set (wrangler pages secret put DATABASE_URL).');
  return neon(env.DATABASE_URL);
}

/** Builds the Worker. `makeSql` is a parameter so tests can hand it a stand-in for the database. */
export function createWorker({ makeSql = defaultSql } = {}) {
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

      const host = (env.DEV_HOST || url.hostname).toLowerCase();
      if (!host || isIpAddress(host)) return json({ error: 'Requests must use a valid hostname, not an IP address.' }, 400);

      const parts = url.pathname.replace(/\/+$/, '').split('/').slice(2); // after "/api"
      const [resource, first, second, extra] = parts;
      const read = request.method === 'GET' || request.method === 'HEAD';
      const notAllowed = (...allowed) => json({ error: `${request.method} is not allowed here.` }, 405, METHODS_FOR(allowed));

      // `route` may answer with a promise: it is AWAITED inside the try below, so a failure in any handler becomes a
      // clean 500 here (a promise that is merely returned would slip past the catch).
      const route = (sql) => {
        switch (resource) {
          case 'catalog':
            if (first !== undefined) break;
            return read ? catalogRoute(request, env, ctx, sql, host) : notAllowed('GET', 'HEAD');
          case 'infos':
            if (first !== undefined) break;
            // (the same address: GET reads the shop's public information, POST lets the shop update it)
            if (request.method === 'POST') return updateInfosRoute(request, env, sql);
            return read ? infosRoute(request, env, ctx, sql, host) : notAllowed('GET', 'HEAD', 'POST');
          case 'frames':
            if (second !== undefined) break;
            if (first === undefined) return read ? framesRoute(request, env, ctx, sql, host, url) : notAllowed('GET', 'HEAD');
            if (read) return frameRoute(request, env, ctx, sql, host, first);
            return notAllowed('GET', 'HEAD');
          case 'accessories':
            if (second !== undefined) break;
            if (first === undefined) return read ? accessoriesRoute(request, env, ctx, sql, host, url) : notAllowed('GET', 'HEAD');
            if (read) return accessoryRoute(request, env, ctx, sql, host, first);
            return notAllowed('GET', 'HEAD');
          case 'images':
            if (extra !== undefined || first === undefined) break;
            if (second === undefined) {
              if (read) return getPhoto(request, env, ctx, first);
              if (request.method === 'DELETE') return deletePhoto(request, env, sql, first);
              if (request.method === 'POST') {
                return apiError(404, 'WRONG_ADDRESS', 'The photo id is missing from the address. Upload with POST /api/images/<code>/<id>?type=frame|accessory.', { expected: 'POST /api/images/{code}/{id}?type=frame|accessory' });
              }
              return notAllowed('GET', 'HEAD', 'DELETE');
            }
            if (request.method === 'POST') return uploadPhoto(request, env, sql, url, first, second);
            return apiError(405, 'METHOD_NOT_ALLOWED', `${request.method} is not allowed here: upload with POST /api/images/<code>/<id>?type=frame|accessory.`, { allowed: ['POST'] }, METHODS_FOR(['POST']));
          case 'register':
            if (first !== undefined) break;
            return request.method === 'POST' ? registerRoute(request, env, sql) : notAllowed('POST');
          case 'expiry':
            if (first !== undefined) break;
            return request.method === 'GET' ? expiryRoute(request, sql) : notAllowed('GET');
          case 'orders':
            if (first === undefined || second !== undefined) break;
            return read ? trackRoute(request, sql, host, first) : notAllowed('GET', 'HEAD');
          case 'table':
            if (first === undefined || second !== undefined) break;
            return request.method === 'POST' ? tableRoute(request, env, sql, url, first) : notAllowed('POST');
          default:
        }
        return json({ error: 'Not found.' }, 404);
      };

      try {
        return await route(makeSql(env));
      } catch (err) {
        console.error('Request failed:', request.method, url.pathname, err);
        return apiError(500, 'SERVER_ERROR', 'The request could not be completed because of a problem on the server. Nothing was changed; the same request can be sent again.', { retry: 'same-request' });
      }
    },
  };
}

export default createWorker();
