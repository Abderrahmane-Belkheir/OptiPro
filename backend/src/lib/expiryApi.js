import express from 'express';
import { createTenantAuthenticator, uploadError } from './imageUpload.js';
import { toDay } from './registerCore.js';

/**
 * GET /api/expiry: the day the shop's licence ends (Authorization: Bearer <tenant key>) -> 200 { expiry: "YYYY-MM-DD" }.
 * The same endpoint, with the same answers, as cloudflare/src/expiry.js. An unknown key, a key in the wrong format, a key whose expiry is
 * empty and an expired key all give the same 401 UNAUTHORIZED. `findActiveTenant(key)` resolves to { key, expiry } or null.
 */
export function createExpiryRouter({ findActiveTenant }) {
  const router = express.Router();
  const authenticate = createTenantAuthenticator(findActiveTenant);

  router.get('/', authenticate, async (req, res, next) => {
    try {
      const tenant = await findActiveTenant(req.tenantKey); // the authenticator only keeps the key: read the expiry again
      if (!tenant) return uploadError(res, 401, 'UNAUTHORIZED', 'A valid tenant key is required: send it as "Authorization: Bearer <tenant key>".');
      res.json({ expiry: toDay(tenant.expiry) });
    } catch (err) {
      next(err);
    }
  });

  router.all('/', (_req, res) => {
    res.set('Allow', 'GET');
    uploadError(res, 405, 'METHOD_NOT_ALLOWED', 'Use GET /api/expiry.');
  });

  return router;
}
