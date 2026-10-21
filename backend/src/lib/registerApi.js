import express from 'express';
import { createTenantAuthenticator, uploadError } from './imageUpload.js';
import { MAX_REGISTER_BODY_BYTES, runRegister } from './registerCore.js';

/**
 * POST /api/register: the shop sends its information (Authorization: Bearer <tenant key>) and the row of the tenants table is updated.
 * The same endpoint, with the same answers, as cloudflare/src/register.js; the rules are in registerCore.js.
 *
 *   1. the key: format, existence, and no expiry yet (findUnregisteredTenant) -> 401 UNAUTHORIZED, the same answer for all of them (429 after too many wrong keys)
 *   2. the body (at most 16 KB, JSON)                                  -> 400 BODY_NOT_JSON, 413 BODY_TOO_LARGE
 *   3. registerCore.js checks it, updates the row and sets the expiry to today + 14 days -> 200 { registered, tenant, expiry } or 400 / 409
 *
 * `findUnregisteredTenant(key)` resolves to { key } for a shop whose key exists and whose expiry is still empty, otherwise to null;
 * `query(text, params)` runs one statement and resolves to its rows.
 */
export function createRegisterRouter({ findUnregisteredTenant, query }) {
  const router = express.Router();
  const authenticate = createTenantAuthenticator(findUnregisteredTenant);

  router.post('/', authenticate, express.json({ limit: MAX_REGISTER_BODY_BYTES, strict: false }), async (req, res, next) => {
    try {
      const result = await runRegister({ tenantKey: req.tenantKey, body: req.body, query });
      res.status(result.status).json(result.body);
    } catch (err) {
      next(err);
    }
  });

  router.all('/', (_req, res) => {
    res.set('Allow', 'POST');
    uploadError(res, 405, 'METHOD_NOT_ALLOWED', 'Use POST /api/register.');
  });

  router.use((err, _req, res, next) => {
    if (res.headersSent) return next(err);
    if (err?.type === 'entity.parse.failed') return uploadError(res, 400, 'BODY_NOT_JSON', 'The body must be JSON: an object with the shop\'s information.');
    if (err?.type === 'entity.too.large') return uploadError(res, 413, 'BODY_TOO_LARGE', `The body is larger than ${MAX_REGISTER_BODY_BYTES} bytes.`);
    console.error('The register endpoint failed:', err);
    return uploadError(res, 500, 'SERVER_ERROR', 'The request could not be handled because of a problem on the server.', { retry: 'same-request' });
  });

  return router;
}
