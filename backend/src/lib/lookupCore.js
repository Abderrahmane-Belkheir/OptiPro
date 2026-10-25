// Finding a customer's orders with the customer's full name and year of birth: POST /api/orders/lookup. What the Express backend and the Cloudflare Worker share (the Worker has a COPY
// of this file, made by: node scripts/sync-table-api.mjs): the checks on what is asked, the SQL, the shape of the answer and the brake on wrong guesses.
//
// Public, no key: the shop is the request's host (like the website's reads); the full name and the year of birth are what identify the customer inside it. The answer holds, for every order
// of the customer, only what the customer needs: the number, the status and dates, the totals, how much has been paid and what is left, and the lines (what was bought and for how much).
// It NEVER holds the prescription, the measurements, the notes, the customer's details, the list of payments (only their sum), nor what the lines cost the shop.

/** The longest full name taken (longer is certainly not a name). */
export const MAX_NAME_LENGTH = 200;
export const MIN_NAME_LENGTH = 2;
/** The year of birth the database accepts: after 1920 and before this year. */
export const FIRST_YEAR_OF_BIRTH = 1921;

/** The biggest body read: a name and a year. */
export const MAX_LOOKUP_BODY_BYTES = 2048;

/** The spaces around a name are dropped and the ones inside it become a single space (the SQL compares the same way, ignoring capital letters). */
export const normalizeName = (name) => name.replace(/\s+/g, ' ').trim();

/**
 * The body checked: { name: string, yearOfBirth: whole year, as a number or as digits }. Returns { name, yearOfBirth } or { error: { code, message } }.
 */
export function readLookup(body, now = new Date()) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: { code: 'BODY_NOT_AN_OBJECT', message: 'The body must be a JSON object: { "name": "<full name>", "yearOfBirth": <year> }.' } };
  }
  const name = typeof body.name === 'string' ? normalizeName(body.name) : '';
  if (name.length < MIN_NAME_LENGTH || name.length > MAX_NAME_LENGTH) {
    return { error: { code: 'INVALID_NAME', message: `"name" must be the customer's full name, ${MIN_NAME_LENGTH} to ${MAX_NAME_LENGTH} characters.` } };
  }
  const raw = body.yearOfBirth;
  const yearOfBirth = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d{4}$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  if (!Number.isInteger(yearOfBirth) || yearOfBirth < FIRST_YEAR_OF_BIRTH || yearOfBirth >= now.getUTCFullYear()) {
    return { error: { code: 'INVALID_YEAR_OF_BIRTH', message: `"yearOfBirth" must be a whole year after 1920 and before ${now.getUTCFullYear()}.` } };
  }
  return { name, yearOfBirth };
}

/**
 * The customers of a shop (set_config 'app.tenant_key' first, from the host) with this full name and this year of birth, each with its orders, each order with its lines and the SUM of its
 * payments, in ONE statement. $1 = the full name (normalized), $2 = the year of birth. A customer without an order gives one row with an empty `number`. Of the payments only the amounts
 * are read (nothing of when, how or by whom), and only added up.
 */
export const LOOKUP_SQL = `
  SELECT o.number, o.status, o.ordered_at, o.promised_at, o.delivered_at, o.subtotal_cents, o.discount_cents, o.total_cents,
         COALESCE((SELECT sum(p.amount_cents) FROM payments p WHERE p.order_id = o.id AND p.tenant_key = o.tenant_key), 0) AS paid_cents,
         COALESCE((SELECT json_agg(json_build_object('kind', i.kind, 'description', i.description, 'eye', i.eye, 'quantity', i.quantity,
                                                     'unitPriceCents', i.unit_price_cents, 'totalCents', i.total_cents) ORDER BY i.created_at, i.id)
                     FROM order_items i WHERE i.order_id = o.id AND i.tenant_key = o.tenant_key), '[]'::json) AS items
    FROM customers c
    LEFT JOIN orders o ON o.customer_id = c.id AND o.tenant_key = c.tenant_key
   WHERE c.tenant_key = current_setting('app.tenant_key') AND c.year_of_birth = $2
     AND lower(regexp_replace(btrim(c.name), '\\s+', ' ', 'g')) = lower($1)
   ORDER BY o.ordered_at DESC NULLS LAST, o.number DESC`;

const iso = (value) => (value === null || value === undefined ? null : new Date(value).toISOString());
const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value : null);

/** One row of LOOKUP_SQL as an order of the answer. */
function shapeOrder(row) {
  const total = Number(row.total_cents);
  const paid = Number(row.paid_cents ?? 0); // (sum() of integers is a bigint in Postgres: the drivers may hand it over as text)
  const items = typeof row.items === 'string' ? JSON.parse(row.items) : (row.items ?? []);
  return {
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
  };
}

/** The rows of LOOKUP_SQL as the answer { orders: [...] }, newest first; null when no customer matched (no row at all). */
export function shapeLookup(rows) {
  if (rows.length === 0) return null;
  return { orders: rows.filter((row) => row.number !== null && row.number !== undefined).map(shapeOrder) };
}

/** After this many asks that match no customer, an address is refused for the rest of the window: a name and a year can be guessed, so guessing must be slow. */
export const MAX_MISSES = 20;
export const MISS_WINDOW_MS = 15 * 60 * 1000;

/** Counts, per address, the asks that matched nothing. It lives in the memory of one running copy of the server: a brake, not a wall (add a rate-limiting rule at the edge for a hard one). */
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
