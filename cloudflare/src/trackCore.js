// COPY of backend/src/lib/trackCore.js for the Worker: do not edit here (run: node scripts/sync-table-api.mjs).
// Following an order with its tracking code: GET /api/orders/<tracking_id>. What the Express backend and the Cloudflare Worker share (the Worker has a COPY of this file,
// made by: node scripts/sync-table-api.mjs): the format of the code, the SQL, the shape of the answer and the brake on wrong codes.
//
// Public, no key: the shop is the request's host (like the website's reads) and the 6-digit code is what identifies the order inside it. The answer holds only what a customer
// following the order needs: the status and dates, the totals, how much has been paid and what is left, the lines (what was bought and for how much) and the shop's name and
// contact. It NEVER holds the prescription, the measurements, the notes, the customer, the list of payments (only their sum), nor what the lines cost the shop.

/** A tracking code: exactly 6 digits, 100000 to 999999. */
export const TRACKING_ID = /^[1-9]\d{5}$/;

/**
 * The order of a shop (set_config 'app.tenant_key' first, from the host), its lines and the SUM of its payments, in ONE statement. $1 = the code, as a number. Of the payments only
 * the amounts are read (nothing of when, how or by whom), and only added up.
 */
export const TRACK_SQL = `
  SELECT o.number, o.tracking_code, o.status, o.ordered_at, o.promised_at, o.delivered_at, o.subtotal_cents, o.discount_cents, o.total_cents,
         COALESCE((SELECT sum(p.amount_cents) FROM payments p WHERE p.order_id = o.id AND p.tenant_key = o.tenant_key), 0) AS paid_cents,
         t.name AS shop_name, t.phone AS shop_phone, t.address AS shop_address,
         COALESCE((SELECT json_agg(json_build_object('kind', i.kind, 'description', i.description, 'eye', i.eye, 'quantity', i.quantity,
                                                     'unitPriceCents', i.unit_price_cents, 'totalCents', i.total_cents) ORDER BY i.created_at, i.id)
                     FROM order_items i WHERE i.order_id = o.id AND i.tenant_key = o.tenant_key), '[]'::json) AS items
    FROM orders o
    JOIN tenants t ON t.key = o.tenant_key
   WHERE o.tenant_key = current_setting('app.tenant_key') AND o.tracking_code = $1`;

const iso = (value) => (value === null || value === undefined ? null : new Date(value).toISOString());
const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value : null);

/** The row of TRACK_SQL as the answer: only what the customer needs (see the top of this file). */
export function shapeTrackedOrder(row) {
  const total = Number(row.total_cents);
  const paid = Number(row.paid_cents ?? 0); // (sum() of integers is a bigint in Postgres: the drivers may hand it over as text)
  const items = typeof row.items === 'string' ? JSON.parse(row.items) : (row.items ?? []);
  return {
    trackingCode: Number(row.tracking_code),
    number: row.number,
    status: row.status,
    orderedAt: iso(row.ordered_at),
    promisedAt: iso(row.promised_at),
    deliveredAt: iso(row.delivered_at),
    currency: 'DZD',
    subtotalCents: Number(row.subtotal_cents),
    discountCents: Number(row.discount_cents),
    totalCents: total,
    paidCents: paid,
    // what is left to pay: the total minus what was paid, never below 0; a cancelled order owes nothing (the same rule as the app's order page)
    remainingCents: row.status === 'cancelled' ? 0 : Math.max(0, total - paid),
    items: items.map((i) => ({
      kind: i.kind,
      description: i.description,
      eye: text(i.eye),
      quantity: Number(i.quantity),
      unitPriceCents: Number(i.unitPriceCents),
      totalCents: Number(i.totalCents),
    })),
    shop: { name: row.shop_name, phone: text(row.shop_phone), address: text(row.shop_address) },
  };
}

/** After this many codes that match no order, an address is refused for the rest of the window: the codes are only 900 000, so guessing must be slow. */
export const MAX_MISSES = 20;
export const MISS_WINDOW_MS = 15 * 60 * 1000;

/** Counts, per address, the codes that matched nothing. It lives in the memory of one running copy of the server: a brake, not a wall (add a rate-limiting rule at the edge for a hard one). */
export function createMissBrake({ max = MAX_MISSES, windowMs = MISS_WINDOW_MS } = {}) {
  const misses = new Map(); // address -> { count, resetAt }
  return {
    /** Milliseconds this address must still wait (0 when it may ask). */
    blockedForMs(ip, now = Date.now()) {
      const entry = misses.get(ip);
      if (!entry) return 0;
      if (entry.resetAt <= now) {
        misses.delete(ip);
        return 0;
      }
      return entry.count >= max ? entry.resetAt - now : 0;
    },
    recordMiss(ip, now = Date.now()) {
      const entry = misses.get(ip);
      if (!entry || entry.resetAt <= now) {
        if (misses.size > 5000) misses.delete(misses.keys().next().value); // never grow without bound
        misses.set(ip, { count: 1, resetAt: now + windowMs });
      } else entry.count += 1;
    },
    reset() {
      misses.clear();
    },
  };
}
