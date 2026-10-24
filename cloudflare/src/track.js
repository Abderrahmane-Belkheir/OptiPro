// GET /api/orders/<tracking_id>: follow an order with its 6-digit tracking code. Public (no key); the shop is the request's host. The same endpoint, with the same answers,
// as backend/src/lib/trackApi.js (see there for the answers).

import { getTrackedOrder, isHostExpired } from './db.js';
import { apiError, decodeSegment, json, malformedAddress } from './http.js';
import { createMissBrake, shapeTrackedOrder, TRACKING_ID } from './trackCore.js';

const brake = createMissBrake();
export const resetTrackBrake = () => brake.reset(); // for tests

const NO_STORE = { 'Cache-Control': 'no-store' }; // the answer is about one customer's order: never kept by a cache

export async function trackRoute(request, sql, host, rawId, now = Date.now()) {
  const id = decodeSegment(rawId);
  if (id === null) return malformedAddress();
  if (!TRACKING_ID.test(id)) return apiError(400, 'INVALID_TRACKING_CODE', 'The tracking code is 6 digits, like 482915.', {}, NO_STORE);

  const ip = request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For') ?? 'unknown';
  const wait = brake.blockedForMs(ip, now);
  if (wait > 0) {
    const seconds = Math.ceil(wait / 1000);
    return apiError(429, 'TOO_MANY_ATTEMPTS', `Too many codes that match no order from this address. Try again in ${seconds} seconds.`, { retry: 'after-delay', retryAfterSeconds: seconds }, { ...NO_STORE, 'Retry-After': String(seconds) });
  }
  if (await isHostExpired(sql, host)) return apiError(403, 'LICENSE_EXPIRED', "This shop's licence has expired.", {}, NO_STORE);

  const row = await getTrackedOrder(sql, host, Number(id));
  if (!row) {
    brake.recordMiss(ip, now);
    return apiError(404, 'ORDER_NOT_FOUND', 'No order was found for this tracking code.', {}, NO_STORE);
  }
  return json(shapeTrackedOrder(row), 200, NO_STORE);
}
