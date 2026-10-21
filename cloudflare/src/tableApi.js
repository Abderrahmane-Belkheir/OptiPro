// The table API: one endpoint through which the desktop app writes its rows to the shop's tables.
//
//   POST /api/table/<name>?action=insert|update|delete
//   Authorization: Bearer <tenant key>
//
// In this order:
//   1. the tenant key must exist in the tenants table                    -> 401 UNAUTHORIZED (429 after too many wrong keys)
//   2. the table must be one of the tables in TABLE_PRIVILEGES           -> 404 TABLE_NOT_FOUND
//   3. `action` must be insert, update or delete, given once             -> 400 INVALID_ACTION
//   4. the table's entry in TABLE_PRIVILEGES must list that action       -> 403 ACTION_NOT_ALLOWED
//   5. the JSON body is read (at most 1 MB)                              -> 400 BODY_NOT_JSON, 413 BODY_TOO_LARGE
//   6. tableCore.js does the rest: validates the body, writes, answers   -> 200 { table, action, count, ... } or the errors it names
//
// Bodies: insert { "rows": [ {...}, ... ] }, update { "where": { column: value }, "set": { column: value } }, delete { column: value }.
// The same endpoint, with the same answers, as backend/src/lib/tableApi.js (the Express backend); the logic in tableCore.js is shared.

import { authenticate } from './auth.js';
import { findTenantByKey } from './db.js';
import { apiError, decodeSegment, json, malformedAddress } from './http.js';
import { photoKey } from './rules.js';
import { runTableAction } from './tableCore.js';

const MAX_BODY_BYTES = 1024 * 1024;

export const ACTIONS = ['insert', 'update', 'delete'];

/**
 * What the shop may do on each table, the same rules as the database login that create_tenant() makes
 * (backend/prisma/create_tenant.sql): the shop's tables can be inserted into, updated and deleted from, except the ones
 * whose rows are never deleted (orders, their lines, payments, invoices, their lines, the number sequences: cancel or void
 * them with a status instead); categories and tenants are read only (an empty list). A table that is not here does not
 * exist for this API. A Map, so a name like "constructor" or "__proto__" is simply not found.
 */
export const TABLE_PRIVILEGES = new Map([
  ['categories', []],
  ['tenants', []],
  ['brands', ['insert', 'update', 'delete']],
  ['frames', ['insert', 'update', 'delete']],
  ['accessories', ['insert', 'update', 'delete']],
  ['product_images', ['insert', 'update', 'delete']],
  ['customers', ['insert', 'update', 'delete']],
  ['prescriptions', ['insert', 'update', 'delete']],
  ['lenses', ['insert', 'update', 'delete']],
  ['orders', ['insert', 'update']],
  ['order_items', ['insert', 'update']],
  ['payments', ['insert', 'update']],
  ['invoices', ['insert', 'update']],
  ['invoice_items', ['insert', 'update']],
  ['number_sequences', ['insert', 'update']],
]);

export async function tableRoute(request, env, sql, url, rawName) {
  const auth = await authenticate(request, (key) => findTenantByKey(sql, key));
  if (auth.response) return auth.response;

  const name = decodeSegment(rawName);
  if (name === null) return malformedAddress();
  const privileges = TABLE_PRIVILEGES.get(name);
  if (!privileges) return apiError(404, 'TABLE_NOT_FOUND', `There is no table "${name}".`, { table: name });

  const given = url.searchParams.getAll('action');
  const action = given.length === 1 ? given[0] : null;
  if (action === null || !ACTIONS.includes(action)) {
    return apiError(400, 'INVALID_ACTION', `The "action" query parameter must be given once and be one of: ${ACTIONS.join(', ')}.`, { table: name });
  }

  if (!privileges.includes(action)) {
    return apiError(403, 'ACTION_NOT_ALLOWED', `"${action}" is not allowed on the table "${name}".${privileges.length ? ` Allowed: ${privileges.join(', ')}.` : ' It is read only.'}`, { table: name, action, allowed: privileges });
  }

  // the body
  const tooLarge = () => apiError(413, 'BODY_TOO_LARGE', `The body is larger than ${MAX_BODY_BYTES} bytes. Send fewer rows per request.`);
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) return tooLarge();
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return tooLarge();
  let body;
  if (text.trim() !== '') {
    try {
      body = JSON.parse(text);
    } catch {
      return apiError(400, 'BODY_NOT_JSON', 'The body must be JSON.');
    }
  }

  const result = await runTableAction({
    table: name,
    action,
    body,
    tenantKey: auth.tenantKey,
    db: {
      query: (sqlText, params) => sql.query(sqlText, params),
      // the files of deleted photos; resolves to the ids whose file could not be removed
      removeFiles: async (photoIds) => {
        const failed = [];
        for (const id of photoIds) {
          try {
            if (!env.IMAGES) throw new Error('the IMAGES bucket is not bound');
            await env.IMAGES.delete(photoKey(id));
          } catch (err) {
            console.error(`Photo ${id}: its row was deleted but its file could not be removed:`, err.message);
            failed.push(id);
          }
        }
        return failed;
      },
    },
  });
  return json(result.body, result.status);
}
