import { TABLE_COLUMNS } from './tableColumns.js';

/**
 * The work of the table API once a request has passed the key, table and action checks (tableApi.js): validate the body
 * against the table's column map, build the SQL, run it, turn what the database says into an answer.
 *
 *   insert  { "rows": [ { ...a full row... }, ... ] }        insert, or overwrite the row with the same id (a brand: the same name)
 *   update  { "where": { column: value, ... }, "set": { column: value, ... } }
 *   delete  { column: value, ... }                            the whole body is the condition
 *
 * Nothing a client sends becomes SQL text: table and column names come from the column map, every value is a parameter.
 * The shop (`tenant_key`) always comes from the tenant key that was sent, never from the body, and is part of every statement.
 *
 * Both servers use this file (the Worker has a copy, see scripts/sync-table-api.mjs), so it touches nothing but its arguments:
 *   db.query(text, params) -> Promise<rows[]>          runs one statement
 *   db.removeFiles(photoIds) -> Promise<string[]>      removes the stored files of photos; resolves to the ids it could not remove
 */

export const MAX_ROWS = 500;
const MAX_ERRORS = 20;
const MAX_CONDITIONS = 20;
const MAX_LIST = 500;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const INT_MIN = -2147483648;
const INT_MAX = 2147483647;
const PG_TYPE = { text: 'text', int: 'int', float: 'float8', bool: 'boolean', datetime: 'timestamp', uuid: 'uuid' };
const NOW = "(now() AT TIME ZONE 'UTC')";

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const fail = (status, code, error, extra = {}) => ({ status, body: { error, code, ...extra } });

// ---- one value ----------------------------------------------------------------------------------------

/** Checks a value against a column's spec. Returns { value } (in the form it is sent to the database) or { error } (in words). */
function coerce(spec, value) {
  switch (spec.type) {
    case 'text':
      if (typeof value !== 'string') return { error: 'must be text' };
      if (value.includes('\u0000')) return { error: 'must not contain a null character' };
      if (spec.kind === 'id') {
        if (!ID_PATTERN.test(value)) return { error: 'must be 1-100 letters, digits, dots, dashes or underscores, starting with a letter or digit' };
      } else if (value.length > (spec.max ?? 1000)) return { error: `must be at most ${spec.max ?? 1000} characters` };
      return { value };
    case 'uuid':
      return typeof value === 'string' && UUID_PATTERN.test(value) ? { value: value.toLowerCase() } : { error: 'must be a UUID' };
    case 'int':
      return typeof value === 'number' && Number.isInteger(value) && value >= INT_MIN && value <= INT_MAX ? { value } : { error: 'must be a whole number' };
    case 'float':
      return typeof value === 'number' && Number.isFinite(value) ? { value } : { error: 'must be a number' };
    case 'bool':
      return typeof value === 'boolean' ? { value } : { error: 'must be true or false' };
    case 'datetime': {
      if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return { error: 'must be an ISO date, like 2026-10-19 or 2026-10-19T14:30:00Z' };
      const text = value.replace(' ', 'T');
      const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(text) ? text : `${text}${text.includes('T') ? '' : 'T00:00:00'}Z`);
      return Number.isNaN(date.getTime()) ? { error: 'is not a real date' } : { value: date.toISOString() };
    }
    case 'textArray':
      if (!Array.isArray(value) || value.length > 50 || value.some((v) => typeof v !== 'string' || v.length > 200 || v.includes('\u0000'))) {
        return { error: 'must be a list of at most 50 texts of at most 200 characters' };
      }
      return { value: JSON.stringify(value) };
    default:
      return { error: 'has an unknown type' };
  }
}

/** The SQL for one parameter of a column: a cast, so the database never has to guess the type. */
const placeholder = (spec, n) => (spec.type === 'textArray' ? `ARRAY(SELECT jsonb_array_elements_text($${n}::jsonb))` : `$${n}::${PG_TYPE[spec.type]}`);

/** Parameters of a statement; the shop's key is always $1. */
function newParams(tenantKey) {
  const params = [tenantKey];
  return { params, add: (value) => params.push(value) };
}

// ---- the condition (update and delete) -----------------------------------------------------------------

/**
 * Turns { column: value } into `col = $n AND ...`. A value is compared for equality; null means IS NULL; a list means "any of these".
 * Returns { sql } or a failed answer.
 */
function buildCondition(t, where, P) {
  if (!isPlainObject(where) || Object.keys(where).length === 0) {
    return fail(400, 'EMPTY_CONDITION', 'The condition must name at least one column and its value, so a mistake can never match every row.');
  }
  const keys = Object.keys(where);
  if (keys.length > MAX_CONDITIONS) return fail(400, 'INVALID_BODY', `A condition can have at most ${MAX_CONDITIONS} columns.`);
  const parts = [];
  for (const key of keys) {
    if (!has(t.columns, key)) return fail(400, 'INVALID_COLUMN', `"${key}" is not a column of "${t.table}" that a condition can use.`, { table: t.table, column: key });
    const spec = t.columns[key];
    const value = where[key];
    if (spec.type === 'textArray') return fail(400, 'INVALID_COLUMN', `"${key}" is a list and cannot be used in a condition.`, { table: t.table, column: key });
    if (value === null) {
      parts.push(`"${spec.column}" IS NULL`);
    } else if (Array.isArray(value)) {
      if (value.length === 0 || value.length > MAX_LIST) return fail(400, 'INVALID_VALUE', `"${key}": a list of values must hold 1 to ${MAX_LIST} values.`, { table: t.table, column: key });
      const clean = [];
      for (const item of value) {
        const checked = item === null ? { error: 'must not be null' } : coerce(spec, item);
        if (checked.error) return fail(400, 'INVALID_VALUE', `"${key}": a value ${checked.error}.`, { table: t.table, column: key });
        clean.push(checked.value);
      }
      const n = P.add(JSON.stringify(clean));
      parts.push(`"${spec.column}" = ANY(ARRAY(SELECT (jsonb_array_elements_text($${n}::jsonb))::${PG_TYPE[spec.type]}))`);
    } else {
      const checked = coerce(spec, value);
      if (checked.error) return fail(400, 'INVALID_VALUE', `"${key}" ${checked.error}.`, { table: t.table, column: key });
      parts.push(`"${spec.column}" = ${placeholder(spec, P.add(checked.value))}`);
    }
  }
  return { sql: parts.join(' AND ') };
}

// ---- parents ---------------------------------------------------------------------------------------------

/**
 * Every foreign key must point at a row of THIS shop (the database's own check also accepts another shop's row, so it is not enough).
 * `wanted` is { field: [values] }. Returns a failed answer for the first field that points at something missing, or null.
 */
async function checkParents(db, t, tenantKey, wanted) {
  for (const [field, values] of Object.entries(wanted)) {
    const parent = t.parents[field];
    const distinct = [...new Set(values.map(String))];
    if (!parent || distinct.length === 0) continue;
    const rows = await db.query(
      `SELECT id::text AS id FROM "${parent.table}" WHERE id = ANY(ARRAY(SELECT (jsonb_array_elements_text($1::jsonb))::${PG_TYPE[parent.idType]}))${parent.tenantScoped ? ' AND tenant_key = $2' : ''}`,
      parent.tenantScoped ? [JSON.stringify(distinct), tenantKey] : [JSON.stringify(distinct)],
    );
    const found = new Set(rows.map((r) => String(r.id)));
    const missing = distinct.filter((v) => !found.has(v));
    if (missing.length) {
      return fail(422, 'PARENT_NOT_FOUND', `"${field}" points at ${parent.table} that this shop does not have: ${missing.slice(0, 5).join(', ')}. Send the parents first.`, { table: t.table, field, parentTable: parent.table, missing: missing.slice(0, 10) });
    }
  }
  return null;
}

// ---- insert ---------------------------------------------------------------------------------------------------

async function insertRows(t, body, tenantKey, db) {
  if (!isPlainObject(body) || Object.keys(body).some((k) => k !== 'rows') || !Array.isArray(body.rows)) {
    return fail(400, 'INVALID_BODY', 'The body must be { "rows": [ { ... }, ... ] }.');
  }
  const { rows } = body;
  if (rows.length === 0) return fail(400, 'INVALID_BODY', '"rows" must hold at least one row.');
  if (rows.length > MAX_ROWS) return fail(413, 'TOO_MANY_ROWS', `At most ${MAX_ROWS} rows can be sent in one request (this one has ${rows.length}).`, { max: MAX_ROWS });

  const errors = [];
  const problem = (row, field, message) => {
    if (errors.length < MAX_ERRORS) errors.push({ row, field, message });
  };
  const clean = [];
  const conflictField = t.conflict ? 'name' : 'id';
  const seen = new Set();
  rows.forEach((row, index) => {
    if (!isPlainObject(row)) return problem(index, null, 'must be an object');
    const out = {};
    for (const key of Object.keys(row)) {
      const spec = has(t.columns, key) ? t.columns[key] : null;
      if (!spec) problem(index, key, `is not a column of "${t.table}"`);
      else if (spec.readOnly) problem(index, key, 'is chosen by the database and cannot be sent');
      else if (row[key] === null) {
        if (spec.required) problem(index, key, 'is required and cannot be null');
        else out[key] = { value: null };
      } else {
        const checked = coerce(spec, row[key]);
        if (checked.error) problem(index, key, checked.error);
        else out[key] = checked;
      }
    }
    for (const [key, spec] of Object.entries(t.columns)) if (spec.required && !has(row, key)) problem(index, key, 'is required');
    const id = row[conflictField];
    if (typeof id === 'string') {
      if (seen.has(id)) problem(index, conflictField, `appears twice in this request`);
      seen.add(id);
    }
    clean.push(out);
  });
  if (errors.length) return fail(400, 'VALIDATION_FAILED', `${errors.length >= MAX_ERRORS ? 'At least ' : ''}${errors.length} problem(s) in the rows; nothing was written.`, { errors });

  // parents of this shop
  const wanted = {};
  for (const field of Object.keys(t.parents)) wanted[field] = clean.map((r) => r[field]?.value).filter((v) => v !== null && v !== undefined);
  const parentProblem = await checkParents(db, t, tenantKey, wanted);
  if (parentProblem) return parentProblem;

  // one multi-row statement: all the rows are written, or none
  const columns = Object.keys(t.columns).filter((key) => !t.columns[key].readOnly && clean.some((r) => has(r, key)));
  const P = newParams(tenantKey);
  const values = clean.map((row) => {
    const cells = columns.map((key) => {
      if (!has(row, key)) return 'DEFAULT';
      if (row[key].value === null) return 'NULL';
      return placeholder(t.columns[key], P.add(row[key].value));
    });
    return `($1${cells.length ? ', ' : ''}${cells.join(', ')}${t.updatedAt ? `, ${NOW}` : ''})`;
  });
  const names = ['tenant_key', ...columns.map((key) => `"${t.columns[key].column}"`), ...(t.updatedAt ? ['updated_at'] : [])];
  const conflict = t.conflict ?? ['id'];
  const conflictColumns = new Set(conflict);
  const sets = columns.filter((key) => !t.columns[key].immutable && !conflictColumns.has(t.columns[key].column)).map((key) => `"${t.columns[key].column}" = EXCLUDED."${t.columns[key].column}"`);
  if (t.updatedAt) sets.push('updated_at = EXCLUDED.updated_at');
  if (sets.length === 0) sets.push(`"${conflict[conflict.length - 1]}" = EXCLUDED."${conflict[conflict.length - 1]}"`);
  const text = `INSERT INTO "${t.table}" (${names.join(', ')}) VALUES ${values.join(', ')}
    ON CONFLICT (${conflict.map((c) => `"${c}"`).join(', ')}) DO UPDATE SET ${sets.join(', ')} WHERE "${t.table}".tenant_key = EXCLUDED.tenant_key
    RETURNING id${t.serialId ? ', name' : ''}`;
  const written = await db.query(text, P.params);

  // a row that was not written is an id that belongs to someone else (the update is limited to this shop's rows)
  if (written.length < rows.length) {
    return fail(409, 'ID_NOT_AVAILABLE', `${rows.length - written.length} of the ${rows.length} rows use an id that already belongs to another record, so they were not written.`, { table: t.table, written: written.length });
  }
  return { status: 200, body: { table: t.table, action: 'insert', count: written.length, ...(t.serialId ? { rows: written.map((r) => ({ id: Number(r.id), name: r.name })) } : {}) } };
}

// ---- update ---------------------------------------------------------------------------------------------------

async function updateRows(t, body, tenantKey, db) {
  if (!isPlainObject(body) || Object.keys(body).some((k) => k !== 'where' && k !== 'set') || !has(body, 'where') || !has(body, 'set')) {
    return fail(400, 'INVALID_BODY', 'The body must be { "where": { column: value, ... }, "set": { column: value, ... } }.');
  }
  if (!isPlainObject(body.set) || Object.keys(body.set).length === 0) return fail(400, 'INVALID_BODY', '"set" must name at least one column and its new value.');

  const assignments = [];
  const wanted = {};
  const P = newParams(tenantKey);
  const condition = buildCondition(t, body.where, P);
  if (condition.status) return condition;
  for (const key of Object.keys(body.set)) {
    const spec = has(t.columns, key) ? t.columns[key] : null;
    const value = body.set[key];
    if (!spec) return fail(400, 'INVALID_COLUMN', `"${key}" is not a column of "${t.table}".`, { table: t.table, column: key });
    if (spec.readOnly || spec.immutable) return fail(400, 'INVALID_COLUMN', `"${key}" cannot be changed.`, { table: t.table, column: key });
    if (value === null) {
      if (spec.required) return fail(400, 'INVALID_VALUE', `"${key}" is required and cannot be set to null.`, { table: t.table, column: key });
      assignments.push(`"${spec.column}" = NULL`);
    } else {
      const checked = coerce(spec, value);
      if (checked.error) return fail(400, 'INVALID_VALUE', `"${key}" ${checked.error}.`, { table: t.table, column: key });
      assignments.push(`"${spec.column}" = ${placeholder(spec, P.add(checked.value))}`);
      if (has(t.parents, key)) wanted[key] = [checked.value];
    }
  }
  if (t.updatedAt) assignments.push(`updated_at = ${NOW}`);
  const parentProblem = await checkParents(db, t, tenantKey, wanted);
  if (parentProblem) return parentProblem;

  // the rows are found first (at most MAX_ROWS + 1 of them), then changed only if there are not too many: one statement
  const text = `WITH target AS (SELECT id FROM "${t.table}" WHERE ${condition.sql} AND tenant_key = $1 ORDER BY id LIMIT ${MAX_ROWS + 1}),
    n AS (SELECT count(*)::int AS c FROM target),
    done AS (UPDATE "${t.table}" SET ${assignments.join(', ')} WHERE id IN (SELECT id FROM target) AND tenant_key = $1 AND (SELECT c FROM n) <= ${MAX_ROWS} RETURNING id)
    SELECT (SELECT c FROM n) AS matched, (SELECT count(*)::int FROM done) AS changed`;
  const [result] = await db.query(text, P.params);
  if (Number(result.matched) > MAX_ROWS) return fail(413, 'TOO_MANY_ROWS', `The condition matches more than ${MAX_ROWS} rows, so nothing was changed. Narrow it down.`, { max: MAX_ROWS });
  return { status: 200, body: { table: t.table, action: 'update', count: Number(result.changed) } };
}

// ---- delete ---------------------------------------------------------------------------------------------------

async function deleteRows(t, body, tenantKey, db) {
  const P = newParams(tenantKey);
  const condition = buildCondition(t, body, P);
  if (condition.status) return condition;

  // Photos have files. Deleting a frame or an accessory: the ids of ALL its photos are fetched first (in the same statement, before
  // the rows are deleted, so the list is the one the delete saw; the photo rows go with the product: the foreign key cascades), the
  // delete is committed, and only if it succeeded are the files removed afterwards, one by one. Deleting photo rows (product_images)
  // returns the ids of the rows that were deleted, for the same purpose.
  const target = `WITH target AS (SELECT id FROM "${t.table}" WHERE ${condition.sql} AND tenant_key = $1 ORDER BY id LIMIT ${MAX_ROWS + 1}),
    n AS (SELECT count(*)::int AS c FROM target)`;
  const guard = `id IN (SELECT id FROM target) AND tenant_key = $1 AND (SELECT c FROM n) <= ${MAX_ROWS}`;
  let text;
  const photoColumn = t.table === 'frames' ? 'frame_id' : t.table === 'accessories' ? 'accessory_id' : null;
  if (photoColumn) {
    text = `${target},
      photos AS (SELECT id::text AS id FROM product_images WHERE ${photoColumn} IN (SELECT id FROM target) AND tenant_key = $1 AND (SELECT c FROM n) <= ${MAX_ROWS}),
      done AS (DELETE FROM "${t.table}" WHERE ${guard} RETURNING id)
      SELECT (SELECT c FROM n) AS matched, (SELECT count(*)::int FROM done) AS changed, ARRAY(SELECT id FROM photos) AS photo_ids`;
  } else if (t.table === 'product_images') {
    text = `${target},
      done AS (DELETE FROM "${t.table}" WHERE ${guard} RETURNING id::text AS id)
      SELECT (SELECT c FROM n) AS matched, (SELECT count(*)::int FROM done) AS changed, ARRAY(SELECT id FROM done) AS photo_ids`;
  } else {
    text = `${target},
      done AS (DELETE FROM "${t.table}" WHERE ${guard} RETURNING id)
      SELECT (SELECT c FROM n) AS matched, (SELECT count(*)::int FROM done) AS changed`;
  }
  const [result] = await db.query(text, P.params);
  if (Number(result.matched) > MAX_ROWS) return fail(413, 'TOO_MANY_ROWS', `The condition matches more than ${MAX_ROWS} rows, so nothing was deleted. Narrow it down.`, { max: MAX_ROWS });

  const count = Number(result.changed);
  const base = { table: t.table, action: 'delete', count };
  if (!photoColumn && t.table !== 'product_images') return { status: 200, body: base };

  // the delete is committed: now the files, one by one (a file that cannot be removed does not stop the others)
  const photoIds = Array.isArray(result.photo_ids) ? result.photo_ids.map(String) : [];
  const failed = photoIds.length ? await db.removeFiles(photoIds) : [];
  const photos = { deleted: photoIds.length, filesRemoved: photoIds.length - failed.length };
  if (failed.length) {
    return fail(500, 'FILE_REMOVAL_FAILED', `The records were deleted, but ${failed.length} of ${photoIds.length} photo file(s) could not be removed from the server's storage. Contact the server's administrator with these photo ids: ${failed.join(', ')}.`, { ...base, recordDeleted: true, photos: { ...photos, filesFailed: failed } });
  }
  return { status: 200, body: { ...base, photos } };
}

// ---- what the database says -------------------------------------------------------------------------------

/**
 * Postgres' SQLSTATE of a failed statement, wherever the driver put it ('' when there is none). Prisma wraps the database's error in
 * its own (code P2010 for a raw query) and keeps the SQLSTATE inside, so its own codes (P1xxx-P9xxx) are never taken for one.
 */
export function sqlState(err) {
  const isState = (c) => typeof c === 'string' && /^[0-9A-Z]{5}$/.test(c) && !/^P[1-9]\d{3}$/.test(c);
  const candidates = [err?.meta?.driverAdapterError?.cause?.originalCode, err?.meta?.code, err?.cause?.code, err?.originalCode, err?.code];
  for (const c of candidates) if (isState(c)) return c;
  const match = /(?:SQLSTATE|code)[:\s"'`]*([0-9A-Z]{5})/i.exec(String(err?.message ?? ''));
  return match && isState(match[1].toUpperCase()) ? match[1].toUpperCase() : '';
}

/** A failure the client can fix is answered; anything else is rethrown (the server answers 500). */
function explain(err, action, t) {
  const state = sqlState(err);
  if (state === '23503' || state === '23001') { // a foreign key (23001: one that says RESTRICT)
    return action === 'delete'
      ? fail(409, 'IN_USE', 'Other records still refer to what the condition matches, so nothing was deleted.', { table: t.table })
      : fail(422, 'PARENT_NOT_FOUND', 'A value points at a record that does not exist. Nothing was written.', { table: t.table });
  }
  if (state === '23505') return fail(409, 'DUPLICATE', 'A row with the same unique value (for example an invoice number) already exists. Nothing was written.', { table: t.table });
  if (state === '42501') return action === 'insert' ? fail(409, 'ID_NOT_AVAILABLE', 'A row uses an id that already belongs to another record. Nothing was written.', { table: t.table }) : fail(403, 'FORBIDDEN', 'The database refused this change.', { table: t.table });
  if (state === '23502' || state === '23514' || state.startsWith('22')) return fail(400, 'INVALID_VALUE', 'The database refused a value. Nothing was written.', { table: t.table });
  throw err;
}

// ---- entry point ------------------------------------------------------------------------------------------------

/** Runs one action on one table. Resolves to { status, body } (never throws for a mistake the client made). */
export async function runTableAction({ table, action, body, tenantKey, db }) {
  const t = has(TABLE_COLUMNS, table) ? TABLE_COLUMNS[table] : null;
  if (!t) return fail(404, 'TABLE_NOT_FOUND', `There is no table "${table}" that can be written to.`, { table });
  try {
    if (action === 'insert') return await insertRows(t, body, tenantKey, db);
    if (action === 'update') return await updateRows(t, body, tenantKey, db);
    if (action === 'delete') return await deleteRows(t, body, tenantKey, db);
    return fail(400, 'INVALID_ACTION', `Unknown action "${action}".`);
  } catch (err) {
    return explain(err, action, t);
  }
}
