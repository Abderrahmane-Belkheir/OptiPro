import { Prisma } from '../generated/prisma/index.js';
import { withTenant } from '../lib/tenantContext.js';

// Built from the Prisma schema (table name -> model) rather than information_schema, so only
// tables this app actually manages are reachable — never _prisma_migrations or anything else
// that happens to live in the same database.
const tables = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.dbName ?? model.name, model]));

export function getTableNames() {
  return [...tables.keys()];
}

const modelsByName = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.name, model]));

// Prisma.dmmf at runtime carries no column defaults or relation columns, so these two facts about
// the schema are spelled out here — update them alongside prisma/schema.prisma.
//   DB_GENERATED_ID_MODELS: models whose id is a database serial, so a new row never carries one.
//   TENANT_OWNED_REFERENCES: every foreign key into another tenant-owned table, by model. Postgres
//   skips RLS when checking a foreign key, so without the check in upsertRows a tenant could point
//   a row at another tenant's brand, customer or order just by guessing its id. Foreign keys to
//   `tenants` (the row's own tenant_key) and to the global `categories` need no check.
//   scripts/check-references.mjs fails if this list and the schema drift apart.
const DB_GENERATED_ID_MODELS = ['Brand'];
export const TENANT_OWNED_REFERENCES = {
  Frame: [{ field: 'brandId', model: 'Brand' }],
  Prescription: [{ field: 'customerId', model: 'Customer' }],
  Order: [
    { field: 'customerId', model: 'Customer' },
    { field: 'prescriptionId', model: 'Prescription' },
  ],
  OrderItem: [
    { field: 'orderId', model: 'Order' },
    { field: 'frameId', model: 'Frame' },
    { field: 'lensId', model: 'Lens' },
    { field: 'accessoryId', model: 'Accessory' },
  ],
  Payment: [
    { field: 'orderId', model: 'Order' },
    { field: 'customerId', model: 'Customer' },
  ],
  Invoice: [
    { field: 'orderId', model: 'Order' },
    { field: 'customerId', model: 'Customer' },
  ],
  InvoiceItem: [{ field: 'invoiceId', model: 'Invoice' }],
};

const MAX_UPSERT_ROWS = 500;

function delegateName(model) {
  return model.name.charAt(0).toLowerCase() + model.name.slice(1);
}

function isTenantOwned(model) {
  return model.fields.some((field) => field.name === 'tenantKey');
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status, expose: true });
}

/** Tables a client may write to (upsert, delete): every tenant-owned one — not categories, not tenants. */
export function isWritable(tableName) {
  const model = tables.get(tableName);
  return Boolean(model) && isTenantOwned(model);
}

function translateDbError(err) {
  if (err.status) return err;
  if (err instanceof Prisma.PrismaClientValidationError) {
    return httpError(400, 'A row is missing a required field or has a value of the wrong type.');
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return httpError(409, 'A row with the same unique value (id or name) already exists.');
    if (err.code === 'P2003') return httpError(400, 'A row references something that does not exist.');
  }
  return err;
}

/**
 * Upserts one row (object body) or several (array body, all-or-nothing) into `tableName` as
 * `tenantKey` (already verified by authorize()): a row whose `id` matches one of this tenant's rows
 * updates it — only the fields sent change — and any other row is inserted. Resolves to
 * `{ rows, created }` where `created` is true when every row was new. The tenant of every row is
 * forced to `tenantKey` — a client never names one — and Postgres RLS's WITH CHECK
 * (prisma/permissions.sql) is the backstop; RLS also means another tenant's row with the same id
 * is invisible here, so inserting it collides on the primary key (409) instead of overwriting it.
 * brands.id is a database serial: a brand is inserted without an `id`, and sending one means
 * "update that brand" (400 if the tenant has none). Throws errors carrying `status`/`expose` for
 * bad input.
 */
export async function upsertRows(tenantKey, tableName, body) {
  const model = tables.get(tableName);
  if (!model || !isTenantOwned(model)) throw new Error(`"${tableName}" is not writable`);

  const isBatch = Array.isArray(body);
  const rows = isBatch ? body : [body];
  if (rows.length === 0 || rows.length > MAX_UPSERT_ROWS) {
    throw httpError(400, `Send between 1 and ${MAX_UPSERT_ROWS} rows.`);
  }
  if (!rows.every((row) => row !== null && typeof row === 'object' && !Array.isArray(row))) {
    throw httpError(400, 'Body must be a JSON object, or an array of objects.');
  }

  const allowed = new Set(
    model.fields.filter((field) => field.kind === 'scalar' && field.name !== 'tenantKey').map((field) => field.name),
  );
  const unknown = [...new Set(rows.flatMap((row) => Object.keys(row)))].filter(
    (key) => key !== 'tenantKey' && !allowed.has(key),
  );
  if (unknown.length) throw httpError(400, `Unknown or read-only field(s): ${unknown.join(', ')}.`);

  const data = rows.map(({ tenantKey: _ignored, ...row }) => ({ ...row, tenantKey }));
  const hasDbGeneratedId = DB_GENERATED_ID_MODELS.includes(model.name);

  try {
    const results = await withTenant(tenantKey, async (tx) => {
      const delegate = tx[delegateName(model)];

      // Visible to this tenant only (RLS), so an id belonging to someone else counts as missing.
      for (const { field, model: refModel } of TENANT_OWNED_REFERENCES[model.name] ?? []) {
        // An optional reference may be left out or null; only ids that are actually sent are checked.
        const ids = [...new Set(data.map((row) => row[field]).filter((value) => value !== undefined && value !== null))];
        if (ids.length === 0) continue;
        const found = await tx[delegateName(modelsByName.get(refModel))].findMany({
          where: { id: { in: ids } },
          select: { id: true },
        });
        if (found.length !== ids.length) {
          throw httpError(400, `${field} does not match an existing ${refModel.toLowerCase()} of yours.`);
        }
      }

      const givenIds = data.map((row) => row.id).filter((id) => id !== undefined);
      const existing = new Set(
        givenIds.length ? (await delegate.findMany({ where: { id: { in: givenIds } }, select: { id: true } })).map((r) => r.id) : [],
      );
      if (hasDbGeneratedId && givenIds.some((id) => !existing.has(id))) {
        throw httpError(400, `A ${model.name.toLowerCase()} id was sent that is not one of yours; omit id to insert a new one.`);
      }

      const out = [];
      for (const row of data) {
        if (row.id !== undefined && existing.has(row.id)) {
          const { id, tenantKey: _tenant, ...changes } = row;
          out.push({ row: await delegate.update({ where: { id }, data: changes }), created: false });
        } else {
          out.push({ row: await delegate.create({ data: row }), created: true });
        }
      }
      return out;
    });
    const saved = results.map((result) => result.row);
    return { rows: isBatch ? saved : saved[0], created: results.every((result) => result.created) };
  } catch (err) {
    throw translateDbError(err);
  }
}

/**
 * Deletes the row with `id` from `tableName` as `tenantKey` (already verified by authorize()).
 * Resolves to false when no such row is visible to this tenant — RLS makes another tenant's row
 * indistinguishable from a missing one. Throws errors carrying `status`/`expose` for a malformed
 * id, or a row that other rows still reference.
 */
export async function deleteRow(tenantKey, tableName, id) {
  const model = tables.get(tableName);
  if (!model || !isTenantOwned(model)) throw new Error(`"${tableName}" is not writable`);

  // brands.id is an Int and the other ids are strings; the URL hands us text either way.
  const isIntId = model.fields.find((field) => field.name === 'id')?.type === 'Int';
  const where = { id: isIntId ? Number(id) : id };
  if (isIntId && !Number.isInteger(where.id)) throw httpError(400, 'id must be an integer.');

  try {
    const { count } = await withTenant(tenantKey, (tx) => tx[delegateName(model)].deleteMany({ where }));
    return count > 0;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      throw httpError(409, "This row is still referenced by other rows, so it can't be deleted.");
    }
    throw err;
  }
}

/**
 * Rows of `tableName` that Postgres lets `tenantKey` see (already verified by authorize()).
 * Resolves to null for an unknown table. There is deliberately no tenant filter here: the
 * row-level security policies in prisma/permissions.sql do it. categories has no policy and is global;
 * tenants is never returned — it holds the keys themselves.
 */
export async function getTableRows(tenantKey, tableName) {
  const model = tables.get(tableName);
  if (!model) return null;

  if (model.name === 'Tenant') return [];

  return withTenant(tenantKey, (tx) => tx[delegateName(model)].findMany());
}
