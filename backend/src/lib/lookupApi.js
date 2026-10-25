import express from 'express';
import { createMissBrake, MAX_LOOKUP_BODY_BYTES, readLookup, shapeLookup } from './lookupCore.js';

/**
 * POST /api/orders/lookup: a customer's orders, found with the customer's full name and year of birth. Public (no key); the shop is the request's host. The same endpoint, with the same
 * answers, as cloudflare/src/lookup.js.
 *
 *   body  { "name": "Amina Benali", "yearOfBirth": 1985 }
 *   200   { orders: [{ number, status, orderedAt, promisedAt, deliveredAt, currency, subtotalCents, discountCents, totalCents, paidCents, remainingCents, items: [...] }] }
 *         (newest first; totalCents is the order's price, paidCents the sum of its payments, remainingCents the total minus it, never below 0 and 0 when cancelled;
 *         a customer with no order gets an empty list)
 *   400   BODY_NOT_JSON | BODY_NOT_AN_OBJECT | INVALID_NAME | INVALID_YEAR_OF_BIRTH
 *   404   CUSTOMER_NOT_FOUND   no customer of this shop has this name and this year of birth (the same answer for any reason)
 *   429   TOO_MANY_ATTEMPTS    the address asked 20 times for customers that do not exist within 15 minutes
 *   403   LICENSE_EXPIRED      (the shop's licence ended: the gate in server.js)
 *
 * `findCustomerOrders(host, name, yearOfBirth)` resolves to the rows of LOOKUP_SQL for the shop of that host (empty when no customer matches).
 */
export function createLookupRouter({ findCustomerOrders, brake = createMissBrake(), now = () => Date.now() }) {
  const router = express.Router();

  router.post('/lookup', express.json({ limit: MAX_LOOKUP_BODY_BYTES, strict: false }), async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store'); // the answer is about one customer: never kept by a cache
      const asked = readLookup(req.body);
      if (asked.error) {
        res.status(400).json({ error: asked.error.message, code: asked.error.code });
        return;
      }
      const ip = req.ip ?? 'unknown';
      const wait = brake.blockedForMs(ip, now());
      if (wait > 0) {
        const seconds = Math.ceil(wait / 1000);
        res.set('Retry-After', String(seconds));
        res.status(429).json({ error: `Too many asks for a customer that does not exist from this address. Try again in ${seconds} seconds.`, code: 'TOO_MANY_ATTEMPTS', retry: 'after-delay', retryAfterSeconds: seconds });
        return;
      }
      const answer = shapeLookup(await findCustomerOrders(req.hostname, asked.name, asked.yearOfBirth));
      if (!answer) {
        brake.recordMiss(ip, now());
        res.status(404).json({ error: 'No customer was found with this name and year of birth.', code: 'CUSTOMER_NOT_FOUND' });
        return;
      }
      res.json(answer);
    } catch (err) {
      next(err);
    }
  });

  router.all('/lookup', (_req, res) => {
    res.set('Allow', 'POST');
    res.status(405).json({ error: 'Use POST /api/orders/lookup.', code: 'METHOD_NOT_ALLOWED' });
  });

  router.use((err, _req, res, next) => {
    if (res.headersSent) return next(err);
    res.set('Cache-Control', 'no-store');
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'The body must be JSON: { "name": "<full name>", "yearOfBirth": <year> }.', code: 'BODY_NOT_JSON' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: `The body is larger than ${MAX_LOOKUP_BODY_BYTES} bytes.`, code: 'BODY_TOO_LARGE' });
    return next(err);
  });

  router.use((_req, res) => {
    res.status(404).json({ error: 'Not found. Find a customer\'s orders with POST /api/orders/lookup.' });
  });

  return router;
}
