// GET /api/expiry: the day the shop's licence ends (Authorization: Bearer <tenant key>) -> 200 { expiry: "YYYY-MM-DD" }.
// The same endpoint, with the same answers, as backend/src/lib/expiryApi.js. An unknown key, a key in the wrong format, a key whose expiry is
// empty and an expired key all give the same 401 UNAUTHORIZED (findActiveTenant).

import { authenticate } from './auth.js';
import { findActiveTenant } from './db.js';
import { json } from './http.js';
import { toDay } from './registerCore.js';

export async function expiryRoute(request, sql) {
  let expiry;
  const auth = await authenticate(request, async (key) => {
    const tenant = await findActiveTenant(sql, key);
    expiry = tenant?.expiry;
    return tenant;
  });
  if (auth.response) return auth.response;
  return json({ expiry: toDay(expiry) }, 200);
}
