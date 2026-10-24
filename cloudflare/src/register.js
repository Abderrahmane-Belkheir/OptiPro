// POST /api/register: the shop sends its information (Authorization: Bearer <tenant key>) and the row of the tenants table is updated.
// The same endpoint, with the same answers, as backend/src/lib/registerApi.js (the Express backend); the rules are in registerCore.js.
//
//   1. the key: format, existence, and not expired (findRegistrableTenant) -> 401 UNAUTHORIZED, the same answer for all of them (429 after too many wrong keys)
//   2. the body (at most 16 KB, JSON)                                  -> 400 BODY_NOT_JSON, 413 BODY_TOO_LARGE
//   3. registerCore.js checks it and updates the row: an empty expiry becomes today + 15 days, an expiry that is set is kept -> 200 { registered, tenant, expiry } or 400 / 500 NOT_UPDATED

import { authenticate } from './auth.js';
import { findRegistrableTenant } from './db.js';
import { apiError, json } from './http.js';
import { MAX_REGISTER_BODY_BYTES, runRegister } from './registerCore.js';

export async function registerRoute(request, env, sql) {
  const auth = await authenticate(request, (key) => findRegistrableTenant(sql, key));
  if (auth.response) return auth.response;

  const tooLarge = () => apiError(413, 'BODY_TOO_LARGE', `The body is larger than ${MAX_REGISTER_BODY_BYTES} bytes.`);
  if (Number(request.headers.get('content-length')) > MAX_REGISTER_BODY_BYTES) return tooLarge();
  const text = await request.text();
  if (text.length > MAX_REGISTER_BODY_BYTES) return tooLarge();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return apiError(400, 'BODY_NOT_JSON', 'The body must be JSON: an object with the shop\'s information.');
  }

  const result = await runRegister({ tenantKey: auth.tenantKey, body, query: (statement, params) => sql.query(statement, params) });
  return json(result.body, result.status);
}
