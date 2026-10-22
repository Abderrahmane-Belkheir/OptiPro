// The logic of POST /api/infos, shared by the Express backend and the Cloudflare Worker (cloudflare/src/infosCore.js is a COPY of this file, kept by
// `node scripts/sync-table-api.mjs`). It knows nothing about HTTP frameworks: it takes the already authenticated shop's key and the parsed body, and
// answers { status, body }.
//
//   POST /api/infos          Authorization: Bearer <tenant key>          body: the shop's information (any of the fields below)
//
// A shop that is already registered sends its information again (the app does it after the licence is running): the shop's row is updated with
// what was sent. In this order (the first step is done by each server before it calls this file):
//   1. the key must have a valid format, exist in the tenants table and have a licence that is running (an expiry that is set and not past)
//                                                                                    -> 401 UNAUTHORIZED (the same answer as every other endpoint:
//                                                                                       a key that does not exist, one never registered, an expired one)
//   2. the body is read (at most 16 KB, JSON)                                          -> 400 BODY_NOT_JSON, 413 BODY_TOO_LARGE
//   3. the body is checked (below)                                                     -> 400 INVALID_BODY, UNKNOWN_FIELD, INVALID_FIELD, NOTHING_TO_UPDATE
//   4. the shop's row is updated with the fields that have a value                     -> 200 { updated, fields, tenant }
//
// Only the fields that HAVE A VALUE are used: a field that is missing, null, or an empty text is ignored (it does not clear what the shop has: unlike
// /api/register, nothing is emptied here). Nothing else is accepted: in particular NOT the shop's `host`, its key or its expiry (sending one is a 400
// UNKNOWN_FIELD). The fields and their rules are the ones of /api/register (registerCore.js), except that none is required:
//   name          1-120 characters      phone  digits, spaces and + ( ) . -, at most 40      email  an e-mail address, at most 254
//   address       at most 300           instagramUrl, tiktokUrl  a web address (http or https), at most 300

import { REGISTER_FIELDS } from './registerCore.js';

export const MAX_INFOS_BODY_BYTES = 16 * 1024;

const fail = (status, code, error, extra = {}) => ({ status, body: { error, code, ...extra } });

/** Checks the body. Answers { values: { column: value, ... } } (only the fields that have a value) or { failure: { status, body } }. */
export function validateInfosBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { failure: fail(400, 'INVALID_BODY', 'The body must be a JSON object with the shop\'s information: { "phone": "...", "address": "...", ... }.') };
  }
  for (const key of Object.keys(body)) {
    if (!Object.hasOwn(REGISTER_FIELDS, key)) {
      return { failure: fail(400, 'UNKNOWN_FIELD', `"${key}" is not a field of the shop's information. Allowed: ${Object.keys(REGISTER_FIELDS).join(', ')}.`, { field: key }) };
    }
  }
  const values = {};
  for (const [field, rule] of Object.entries(REGISTER_FIELDS)) {
    if (!Object.hasOwn(body, field)) continue;
    const raw = body[field];
    if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) continue; // no value: left out, nothing is cleared
    if (typeof raw !== 'string') return { failure: fail(400, 'INVALID_FIELD', `"${field}" must be text.`, { field }) };
    const value = raw.trim();
    if (value.length > rule.max) return { failure: fail(400, 'INVALID_FIELD', `"${field}" is longer than ${rule.max} characters.`, { field }) };
    const problem = rule.check?.(value) ?? null;
    if (problem) return { failure: fail(400, 'INVALID_FIELD', `"${field}" ${problem}.`, { field }) };
    values[rule.column] = value;
  }
  if (Object.keys(values).length === 0) {
    return { failure: fail(400, 'NOTHING_TO_UPDATE', `The body has no field with a value, so there is nothing to update. Send at least one of: ${Object.keys(REGISTER_FIELDS).join(', ')}.`) };
  }
  return { values };
}

/**
 * The UPDATE for the shop's row: the columns that have a value, only while the licence is running. Column names come from the rules above, never from the
 * body, so nothing the client sends can name a column; the expiry and the key are never in the SET list.
 */
export function buildInfosUpdate(tenantKey, values) {
  const columns = Object.keys(values);
  const sets = columns.map((column, i) => `${column} = $${i + 2}`);
  return {
    text: `UPDATE tenants SET ${sets.join(', ')} WHERE key = $1 AND expiry IS NOT NULL AND expiry::date >= (now() AT TIME ZONE 'UTC')::date RETURNING key, name, phone, email, address, instagram_url, tiktok_url`,
    params: [tenantKey, ...columns.map((c) => values[c])],
  };
}

/** The body's field names for the columns that were updated, in the order of the rules: ["phone", "address"]. */
const fieldsOf = (values) => Object.entries(REGISTER_FIELDS).filter(([, rule]) => Object.hasOwn(values, rule.column)).map(([field]) => field);

/**
 * Validates the body and updates the shop's row. `query(text, params)` runs one statement and resolves to its rows.
 * Answers { status, body }: 200 { updated: true, fields: [...], tenant: {...} }, or the failure to send as it is.
 *
 * An update that changes no row for a key that has just been accepted is NOT answered with 401: the key is fine, so the app must not read it as a refusal
 * of the licence (it would lock the shop out). It means the database refused the write (for example the shop's login may not update its own row yet, see
 * backend/prisma/create_tenant.sql) or the licence ran out a moment ago: 500 NOT_UPDATED, and the same request can be sent again.
 */
export async function runInfos({ tenantKey, body, query }) {
  const checked = validateInfosBody(body);
  if (checked.failure) return checked.failure;
  const { text, params } = buildInfosUpdate(tenantKey, checked.values);
  const rows = await query(text, params);
  const row = rows?.[0];
  if (!row) return fail(500, 'NOT_UPDATED', 'The shop\'s information could not be saved on the server. Nothing was changed; the same request can be sent again.', { retry: 'same-request' });
  return {
    status: 200,
    body: {
      updated: true,
      fields: fieldsOf(checked.values),
      tenant: { name: row.name, phone: row.phone, email: row.email, address: row.address, instagramUrl: row.instagram_url, tiktokUrl: row.tiktok_url },
    },
  };
}
