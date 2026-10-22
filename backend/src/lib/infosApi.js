import express from 'express';
import { createTenantAuthenticator, uploadError } from './imageUpload.js';
import { MAX_INFOS_BODY_BYTES, runInfos } from './infosCore.js';

/**
 * POST /api/infos: a registered shop sends its information (Authorization: Bearer <tenant key>) and the fields that have a value update its row of the
 * tenants table. The same endpoint, with the same answers, as cloudflare/src/infos.js; the rules are in infosCore.js. (GET /api/infos, the website's
 * public information, is the same address and keeps working: this router lets it through.)
 *
 *   1. the key: format, existence, and a licence that is running (findActiveTenant) -> 401 UNAUTHORIZED, the same answer for all of them (429 after too many wrong keys)
 *   2. the body (at most 16 KB, JSON)                                  -> 400 BODY_NOT_JSON, 413 BODY_TOO_LARGE
 *   3. infosCore.js checks it and updates the row                      -> 200 { updated, fields, tenant } or 400 / 500 NOT_UPDATED
 *
 * `findActiveTenant(key)` resolves to { key, expiry } for a shop whose licence is running, otherwise to null;
 * `query(text, params)` runs one statement and resolves to its rows.
 */
export function createInfosRouter({ findActiveTenant, query }) {
  const router = express.Router();
  const authenticate = createTenantAuthenticator(findActiveTenant);

  router.post('/', authenticate, express.json({ limit: MAX_INFOS_BODY_BYTES, strict: false }), async (req, res, next) => {
    try {
      const result = await runInfos({ tenantKey: req.tenantKey, body: req.body, query });
      res.status(result.status).json(result.body);
    } catch (err) {
      next(err);
    }
  });

  // (the same address as GET /api/infos, the website's public information: that one is answered further down in server.js)
  router.all('/', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next('router');
    res.set('Allow', 'GET, HEAD, POST');
    uploadError(res, 405, 'METHOD_NOT_ALLOWED', "Use GET /api/infos to read the shop's information, POST /api/infos to update it.");
  });

  router.use((err, _req, res, next) => {
    if (res.headersSent) return next(err);
    if (err?.type === 'entity.parse.failed') return uploadError(res, 400, 'BODY_NOT_JSON', 'The body must be JSON: an object with the shop\'s information.');
    if (err?.type === 'entity.too.large') return uploadError(res, 413, 'BODY_TOO_LARGE', `The body is larger than ${MAX_INFOS_BODY_BYTES} bytes.`);
    console.error('The infos endpoint failed:', err);
    return uploadError(res, 500, 'SERVER_ERROR', 'The request could not be handled because of a problem on the server.', { retry: 'same-request' });
  });

  return router;
}
