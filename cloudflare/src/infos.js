// POST /api/infos: a registered shop sends its information (Authorization: Bearer <tenant key>) and the fields that have a value update its row of the
// tenants table. The same endpoint, with the same answers, as backend/src/lib/infosApi.js (the Express backend); the rules are in infosCore.js.
//
//   1. the key: format, existence, and a licence that is running (findActiveTenant) -> 401 UNAUTHORIZED, the same answer for all of them (429 after too many wrong keys)
//   2. the body (at most 16 KB, JSON)                                  -> 400 BODY_NOT_JSON, 413 BODY_TOO_LARGE
//   3. infosCore.js checks it and updates the row                      -> 200 { updated, fields, tenant } or 400 / 500 NOT_UPDATED

import { authenticate } from './auth.js';
import { findActiveTenant } from './db.js';
import { apiError, json } from './http.js';
import { MAX_INFOS_BODY_BYTES, runInfos } from './infosCore.js';

export async function updateInfosRoute(request, env, sql) {
  const auth = await authenticate(request, (key) => findActiveTenant(sql, key));
  if (auth.response) return auth.response;

  const tooLarge = () => apiError(413, 'BODY_TOO_LARGE', `The body is larger than ${MAX_INFOS_BODY_BYTES} bytes.`);
  if (Number(request.headers.get('content-length')) > MAX_INFOS_BODY_BYTES) return tooLarge();
  const text = await request.text();
  if (text.length > MAX_INFOS_BODY_BYTES) return tooLarge();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return apiError(400, 'BODY_NOT_JSON', 'The body must be JSON: an object with the shop\'s information.');
  }

  const result = await runInfos({ tenantKey: auth.tenantKey, body, query: (statement, params) => sql.query(statement, params) });
  return json(result.body, result.status);
}
