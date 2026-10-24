// The logic of POST /api/register, shared by the Express backend and the Cloudflare Worker (cloudflare/src/registerCore.js is a COPY of this
// file, kept by `node scripts/sync-table-api.mjs`). It knows nothing about HTTP frameworks: it takes the already authenticated shop's key and the
// parsed body, and answers { status, body }.
//
//   POST /api/register          Authorization: Bearer <tenant key>          body: the shop's information
//
// In this order (the first two are done by each server before it calls this file):
//   1. the key must have a valid format, exist in the tenants table and not be expired (its expiry is empty, or a day that has not passed)
//                                                                                    -> 401 UNAUTHORIZED (the same answer for all of these:
//                                                                                       a key that does not exist, a malformed one, an expired one)
//   2. the body is read (at most 16 KB, JSON)                                          -> 400 BODY_NOT_JSON, 413 BODY_TOO_LARGE
//   3. the body is checked (below)                                                     -> 400 INVALID_BODY, UNKNOWN_FIELD, MISSING_FIELD, INVALID_FIELD
//   4. the shop's row is updated with what was sent                                    -> 200 { registered, tenant, expiry }
//      The EXPIRY: when it is empty the shop is registering for the first time and gets today + 15 days (UTC); when it already has a day, that day is KEPT
//      (registering again, or a shop whose expiry was set by hand, never changes it). One statement does both (COALESCE), so two requests at once cannot
//      disagree: the second one finds the day the first one set and keeps it.
//      A row the database refuses to update for a key that was just accepted (a policy that does not let the shop's login update its row) is a
//      500 NOT_UPDATED, never a 401: the key is fine, and the app must not read it as a refusal of the licence.
//
// The body is a JSON object with the shop's details. `name` is required; the others are optional (null or "" clears them);
// a field that is not sent is left as it is. Nothing else is accepted: in particular NOT the shop's `host` (its website address), which is set by hand
// in the database and never touched by this endpoint (sending it is a 400 UNKNOWN_FIELD), nor the key or the expiry.
//   name          the shop's name                                   1-120 characters
//   phone         digits, spaces and + ( ) . -                       at most 40 characters
//   email         an e-mail address                                  at most 254 characters
//   address       free text                                          at most 300 characters
//   instagramUrl  a web address (http or https)                      at most 300 characters
//   tiktokUrl     a web address (http or https)                      at most 300 characters

export const MAX_REGISTER_BODY_BYTES = 16 * 1024;

/** How many days a shop's licence lasts from the day it registers. */
export const REGISTER_DAYS = 15;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[\d\s().-]{3,40}$/;

const webAddress = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

/** field name in the body -> { column, required, max, check(value) -> a problem in words, or null } */
export const REGISTER_FIELDS = {
  name: { column: 'name', required: true, max: 120 },
  phone: { column: 'phone', max: 40, check: (v) => (PHONE.test(v) ? null : 'must be a phone number (digits, spaces and + ( ) . -)') },
  email: { column: 'email', max: 254, check: (v) => (EMAIL.test(v) ? null : 'must be an e-mail address') },
  address: { column: 'address', max: 300 },
  instagramUrl: { column: 'instagram_url', max: 300, check: (v) => (webAddress(v) ? null : 'must be a web address starting with http:// or https://') },
  tiktokUrl: { column: 'tiktok_url', max: 300, check: (v) => (webAddress(v) ? null : 'must be a web address starting with http:// or https://') },
};

const fail = (status, code, error, extra = {}) => ({ status, body: { error, code, ...extra } });

/** Checks the body. Answers { values: { column: value|null, ... } } or { failure: { status, body } }. */
export function validateRegisterBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { failure: fail(400, 'INVALID_BODY', 'The body must be a JSON object with the shop\'s information: { "name": "...", "phone": "...", ... }.') };
  }
  for (const key of Object.keys(body)) {
    if (!Object.hasOwn(REGISTER_FIELDS, key)) {
      return { failure: fail(400, 'UNKNOWN_FIELD', `"${key}" is not a field of the shop's information. Allowed: ${Object.keys(REGISTER_FIELDS).join(', ')}.`, { field: key }) };
    }
  }
  const values = {};
  for (const [field, rule] of Object.entries(REGISTER_FIELDS)) {
    if (!Object.hasOwn(body, field)) {
      if (rule.required) return { failure: fail(400, 'MISSING_FIELD', `"${field}" is required.`, { field }) };
      continue;
    }
    const raw = body[field];
    if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
      if (rule.required) return { failure: fail(400, 'INVALID_FIELD', `"${field}" is required and cannot be empty.`, { field }) };
      values[rule.column] = null;
      continue;
    }
    if (typeof raw !== 'string') return { failure: fail(400, 'INVALID_FIELD', `"${field}" must be text.`, { field }) };
    let value = raw.trim();
    if (rule.lower) value = value.toLowerCase();
    if (value.length > rule.max) return { failure: fail(400, 'INVALID_FIELD', `"${field}" is longer than ${rule.max} characters.`, { field }) };
    const problem = rule.check?.(value) ?? null;
    if (problem) return { failure: fail(400, 'INVALID_FIELD', `"${field}" ${problem}.`, { field }) };
    values[rule.column] = value;
  }
  return { values };
}

/**
 * The UPDATE for the shop's row: the columns that were sent, and `expiry` = the day it already has, or today + 15 days when it has none (COALESCE), only for a
 * licence that is not expired. Column names come from the rules above, never from the body; the number of days is a constant of this file.
 */
export function buildRegisterUpdate(tenantKey, values) {
  const columns = Object.keys(values);
  const sets = columns.map((column, i) => `${column} = $${i + 2}`);
  return {
    text: `UPDATE tenants SET ${sets.join(', ')}, expiry = COALESCE(expiry, (now() AT TIME ZONE 'UTC')::date + ${REGISTER_DAYS}) WHERE key = $1 AND (expiry IS NULL OR expiry::date >= (now() AT TIME ZONE 'UTC')::date) RETURNING key, name, host, phone, email, address, instagram_url, tiktok_url, expiry`,
    params: [tenantKey, ...columns.map((c) => values[c])],
  };
}


/** A date column as "YYYY-MM-DD" (or null). */
export const toDay = (value) => {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
};

/**
 * Validates the body and updates the shop's row. `query(text, params)` runs one statement and resolves to its rows.
 * Answers { status, body }: 200 { registered: true, tenant: {...}, expiry: "YYYY-MM-DD" | null }, or the failure to send as it is.
 */
export async function runRegister({ tenantKey, body, query }) {
  const checked = validateRegisterBody(body);
  if (checked.failure) return checked.failure;
  const { text, params } = buildRegisterUpdate(tenantKey, checked.values);
  let rows;
  try {
    rows = await query(text, params);
  } catch (err) {
    throw err;
  }
  const row = rows?.[0];
  if (!row) return fail(500, 'NOT_UPDATED', "The shop's information could not be saved on the server. Nothing was changed; the same request can be sent again.", { retry: 'same-request' });
  return {
    status: 200,
    body: {
      registered: true,
      tenant: { name: row.name, host: row.host, phone: row.phone, email: row.email, address: row.address, instagramUrl: row.instagram_url, tiktokUrl: row.tiktok_url },
      expiry: toDay(row.expiry),
    },
  };
}
