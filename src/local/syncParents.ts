// The one place that says which rows must be synced before another can be pushed.
//
// A row is only sent to the remote database when EVERY row it points at (its "parents") is already synced —
// one unsynced parent is enough to hold it back, because the remote database refuses a row that refers to
// something it doesn't have. Optional references left empty don't count.
//
// Only tables that have a `synced` column can be parents: foreign keys into `categories` (global,
// read-only, never pushed) and `tenants` are not listed. `npm run build` runs
// scripts/check-sync-parents.mjs, which fails if this list and prisma/sqlite/schema.prisma disagree
// (including which references are optional), so adding a foreign key without deciding how it syncs
// can't slip through.
//
// This file must stay free of imports: the check script loads it on its own.

/** Table name -> the Prisma delegate for it and the word used in messages. */
export const SYNCED_TABLES = {
  brands: { delegate: "brand", label: "brand" },
  customers: { delegate: "customer", label: "customer" },
  frames: { delegate: "frame", label: "frame" },
  accessories: { delegate: "accessory", label: "accessory" },
  lenses: { delegate: "lens", label: "lens" },
  suppliers: { delegate: "supplier", label: "supplier" },
  prescriptions: { delegate: "prescription", label: "prescription" },
  orders: { delegate: "order", label: "order" },
  invoices: { delegate: "invoice", label: "invoice" },
} as const;

type TableName = keyof typeof SYNCED_TABLES;

export interface SyncParent {
  /** The foreign-key column on the child, e.g. "customerId". */
  field: string;
  /** The table it points at. */
  parent: TableName;
  /** True when the column may be empty (null): then there is no parent to wait for. */
  optional?: boolean;
}

/**
 * child table -> its foreign-key columns and the table each one points at.
 * By convention the Prisma relation is the column without its "Id" (customerId -> customer);
 * the check script enforces that too, because the SQL filter in syncPush.ts relies on it.
 */
export const SYNC_PARENTS: Record<string, SyncParent[]> = {
  frames: [{ field: "brandId", parent: "brands" }],
  prescriptions: [{ field: "customerId", parent: "customers" }],
  orders: [
    { field: "customerId", parent: "customers", optional: true },
    { field: "prescriptionId", parent: "prescriptions", optional: true },
  ],
  order_items: [
    { field: "orderId", parent: "orders" },
    { field: "frameId", parent: "frames", optional: true },
    { field: "lensId", parent: "lenses", optional: true },
    { field: "accessoryId", parent: "accessories", optional: true },
  ],
  payments: [
    { field: "orderId", parent: "orders", optional: true },
    { field: "customerId", parent: "customers", optional: true },
  ],
  invoices: [
    { field: "orderId", parent: "orders", optional: true },
    { field: "customerId", parent: "customers", optional: true },
  ],
  invoice_items: [{ field: "invoiceId", parent: "invoices" }],
  // A photo belongs to a frame OR an accessory (one of the two is empty). Nothing pushes photos through the
  // sync scheduler yet; the references are declared so the rule is already right when something does.
  product_images: [
    { field: "frameId", parent: "frames", optional: true },
    { field: "accessoryId", parent: "accessories", optional: true },
  ],
};

/** The parents of a table in the shape the shared sync engine (tableService.ts) wants. */
export function parentsOf(table: string): { field: string; delegate: string; label: string }[] {
  return (SYNC_PARENTS[table] ?? []).map(({ field, parent }) => ({ field, ...SYNCED_TABLES[parent] }));
}
