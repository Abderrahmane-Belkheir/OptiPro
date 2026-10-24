import express from 'express';
import { createMissBrake, shapeTrackedOrder, TRACKING_ID } from './trackCore.js';

/**
 * GET /api/orders/<tracking_id>: follow an order with its 6-digit tracking code. Public (no key); the shop is the request's host. The same endpoint, with the same answers,
 * as cloudflare/src/track.js.
 *
 *   200  { trackingCode, number, status, orderedAt, promisedAt, deliveredAt, currency, subtotalCents, discountCents, totalCents, paidCents, remainingCents,
 *          items: [...], shop: { name, phone, address } }   (paidCents is the sum of the order's payments; remainingCents is the total minus it, never below 0, and 0 when cancelled)
 *   400  INVALID_TRACKING_CODE   the code is not 6 digits
 *   404  ORDER_NOT_FOUND         no order of this shop has this code (the same answer for any reason)
 *   429  TOO_MANY_ATTEMPTS       the address sent 20 codes that matched nothing within 15 minutes
 *   403  LICENSE_EXPIRED         (the shop's licence ended: the gate in server.js)
 *
 * `findTrackedOrder(host, code)` resolves to the row of TRACK_SQL for the shop of that host, or null.
 */
export function createTrackRouter({ findTrackedOrder, brake = createMissBrake(), now = () => Date.now() }) {
  const router = express.Router();

  router.get('/:tracking_id', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store'); // the answer is about one customer's order: never kept by a cache
      const id = req.params.tracking_id;
      if (!TRACKING_ID.test(id)) {
        res.status(400).json({ error: 'The tracking code is 6 digits, like 482915.', code: 'INVALID_TRACKING_CODE' });
        return;
      }
      const ip = req.ip ?? 'unknown';
      const wait = brake.blockedForMs(ip, now());
      if (wait > 0) {
        const seconds = Math.ceil(wait / 1000);
        res.set('Retry-After', String(seconds));
        res.status(429).json({ error: `Too many codes that match no order from this address. Try again in ${seconds} seconds.`, code: 'TOO_MANY_ATTEMPTS', retry: 'after-delay', retryAfterSeconds: seconds });
        return;
      }
      const row = await findTrackedOrder(req.hostname, Number(id));
      if (!row) {
        brake.recordMiss(ip, now());
        res.status(404).json({ error: 'No order was found for this tracking code.', code: 'ORDER_NOT_FOUND' });
        return;
      }
      res.json(shapeTrackedOrder(row));
    } catch (err) {
      next(err);
    }
  });

  router.all('/:tracking_id', (_req, res) => {
    res.set('Allow', 'GET, HEAD');
    res.status(405).json({ error: 'Use GET /api/orders/<tracking code>.', code: 'METHOD_NOT_ALLOWED' });
  });

  router.use((_req, res) => {
    res.status(404).json({ error: 'Not found. Follow an order with GET /api/orders/<tracking code>.' });
  });

  return router;
}
