// POST /api/orders/lookup: a customer's orders, found with the customer's full name and year of birth. Public (no key); the shop is the request's host. The same endpoint, with the same
// answers, as backend/src/lib/lookupApi.js (see there for the answers).

import { getCustomerOrders, isHostExpired } from './db.js';
import { apiError, json } from './http.js';
import { createMissBrake, MAX_LOOKUP_BODY_BYTES, readLookup, shapeLookup } from './lookupCore.js';

const brake = createMissBrake();
export const resetLookupBrake = () => brake.reset(); // for tests

const NO_STORE = { 'Cache-Control': 'no-store' }; // the answer is about one customer: never kept by a cache

export async function lookupRoute(request, sql, host, now = Date.now()) {
  const tooLarge = () => apiError(413, 'BODY_TOO_LARGE', `The body is larger than ${MAX_LOOKUP_BODY_BYTES} bytes.`, {}, NO_STORE);
  if (Number(request.headers.get('content-length')) > MAX_LOOKUP_BODY_BYTES) return tooLarge();
  const text = await request.text();
  if (text.length > MAX_LOOKUP_BODY_BYTES) return tooLarge();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return apiError(400, 'BODY_NOT_JSON', 'The body must be JSON: { "name": "<full name>", "yearOfBirth": <year> }.', {}, NO_STORE);
  }
  const asked = readLookup(body);
  if (asked.error) return apiError(400, asked.error.code, asked.error.message, {}, NO_STORE);

  const ip = request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For') ?? 'unknown';
  const wait = brake.blockedForMs(ip, now);
  if (wait > 0) {
    const seconds = Math.ceil(wait / 1000);
    return apiError(429, 'TOO_MANY_ATTEMPTS', `Too many asks for a customer that does not exist from this address. Try again in ${seconds} seconds.`, { retry: 'after-delay', retryAfterSeconds: seconds }, { ...NO_STORE, 'Retry-After': String(seconds) });
  }
  if (await isHostExpired(sql, host)) return apiError(403, 'LICENSE_EXPIRED', "This shop's licence has expired.", {}, NO_STORE);

  const answer = shapeLookup(await getCustomerOrders(sql, host, asked.name, asked.yearOfBirth));
  if (!answer) {
    brake.recordMiss(ip, now);
    return apiError(404, 'CUSTOMER_NOT_FOUND', 'No customer was found with this name and year of birth.', {}, NO_STORE);
  }
  return json(answer, 200, NO_STORE);
}
