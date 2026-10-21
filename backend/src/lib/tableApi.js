import express from 'express';
import { createTenantAuthenticator, uploadError } from './imageUpload.js';
import { runTableAction } from './tableCore.js';

const MAX_BODY = '1mb';

/**
 * The table API: one endpoint through which the desktop app writes its rows to the shop's tables.
 *
 *   POST /api/table/<name>?action=insert|update|delete
 *   Authorization: Bearer <tenant key>
 *
 * In this order:
 *   1. the tenant key must exist in the tenants table and not be expired (`findActiveTenant`) -> 401 UNAUTHORIZED, the same answer for both (429 after too many wrong keys)
 *   2. the table must be one of the tables in TABLE_PRIVILEGES                      -> 404 TABLE_NOT_FOUND
 *   3. `action` must be insert, update or delete                                    -> 400 INVALID_ACTION
 *   4. the table's entry in TABLE_PRIVILEGES must list that action                  -> 403 ACTION_NOT_ALLOWED
 *   5. the JSON body is read (at most 1 MB)                                         -> 400 BODY_NOT_JSON, 413 BODY_TOO_LARGE
 *   6. tableCore.js does the rest: validates the body, writes, answers              -> 200 { table, action, count, ... } or the errors it names
 *
 * Bodies: insert { "rows": [ {...}, ... ] }, update { "where": { column: value }, "set": { column: value } }, delete { column: value }.
 * `runQuery(tenantKey, text, params)` runs one statement as that shop; `removeFiles(photoIds)` removes photo files and resolves to the
 * ids it could not remove.
 */

export const ACTIONS = ['insert', 'update', 'delete'];

/**
 * What the shop may do on each table, the same rules as the database login that create_tenant() makes
 * (backend/prisma/create_tenant.sql): the shop's tables can be inserted into, updated and deleted from, except the ones
 * whose rows are never deleted (orders, their lines, payments, invoices, their lines, the number sequences: cancel or void them
 * with a status instead); categories and tenants are read only (an empty list). A table that is not here does not exist
 * for this API. A Map, so a name like "constructor" or "__proto__" is simply not found.
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

export function createTableApiRouter({ findActiveTenant, runQuery, removeFiles }) {
  const router = express.Router();
  const authenticate = createTenantAuthenticator(findActiveTenant);

  // the checks, then the body is read (only for a request that got this far), then the work
  router.post(
    '/:name',
    authenticate,
    (req, res, next) => {
      const { name } = req.params;
      const privileges = TABLE_PRIVILEGES.get(name);
      if (!privileges) {
        uploadError(res, 404, 'TABLE_NOT_FOUND', `There is no table "${name}".`, { table: name });
        return;
      }

      const { action } = req.query;
      if (typeof action !== 'string' || !ACTIONS.includes(action)) {
        uploadError(res, 400, 'INVALID_ACTION', `The "action" query parameter must be one of: ${ACTIONS.join(', ')}.`, { table: name });
        return;
      }

      if (!privileges.includes(action)) {
        uploadError(res, 403, 'ACTION_NOT_ALLOWED', `"${action}" is not allowed on the table "${name}".${privileges.length ? ` Allowed: ${privileges.join(', ')}.` : ' It is read only.'}`, { table: name, action, allowed: privileges });
        return;
      }
      next();
    },
    express.json({ limit: MAX_BODY }),
    async (req, res) => {
      const result = await runTableAction({
        table: req.params.name,
        action: req.query.action,
        body: req.body,
        tenantKey: req.tenantKey,
        db: {
          query: (text, params) => runQuery(req.tenantKey, text, params),
          removeFiles: (photoIds) => removeFiles(photoIds),
        },
      });
      res.status(result.status).json(result.body);
    },
  );

  // Any other method on a table's address.
  router.all('/:name', (_req, res) => {
    res.set('Allow', 'POST');
    uploadError(res, 405, 'METHOD_NOT_ALLOWED', 'Use POST /api/table/<name>?action=insert|update|delete.');
  });

  router.use((err, _req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof URIError) return uploadError(res, 400, 'MALFORMED_ADDRESS', 'The address contains an invalid percent-escape.');
    if (err?.type === 'entity.parse.failed') return uploadError(res, 400, 'BODY_NOT_JSON', 'The body must be JSON.');
    if (err?.type === 'entity.too.large') return uploadError(res, 413, 'BODY_TOO_LARGE', `The body is larger than ${MAX_BODY}. Send fewer rows per request.`);
    console.error('The table API failed:', err);
    return uploadError(res, 500, 'SERVER_ERROR', 'The request could not be handled because of a problem on the server.', { retry: 'same-request' });
  });

  return router;
}
