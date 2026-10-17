import { apiRequest } from "./apiClient";

// The three routes the desktop app uses, all authenticated by the tenant key:
//   GET    /api/tables/:table       every row of the table the tenant can see
//   POST   /api/tables/:table       upsert one row (object) or several (array, all-or-nothing):
//                                   a row whose id the tenant already has is updated, others are inserted
//   DELETE /api/tables/:table/:id   delete one row
//
// `tenants` is left out on purpose: GET always answers [] for it and it can't be written.
// `categories` is read-only — the backend answers 405 to a POST or DELETE on it.

export type WritableTable =
  | "brands" | "frames" | "accessories" | "customers"
  | "prescriptions" | "lenses" | "orders" | "order_items" | "payments" | "invoices" | "invoice_items" | "number_sequences";
export type ReadableTable = WritableTable | "categories";

const tablePath = (table: ReadableTable) => `/api/tables/${table}`;

export function listRows<Row>(table: ReadableTable): Promise<Row[]> {
  return apiRequest<Row[]>("GET", tablePath(table));
}

/** Resolves to the saved row, including database-generated values (ids, timestamps). */
export function upsertRow<Row, NewRow>(table: WritableTable, row: NewRow): Promise<Row> {
  return apiRequest<Row>("POST", tablePath(table), row);
}

/** All rows are saved or none are (up to 500 at a time). Resolves to the saved rows. */
export function upsertRows<Row, NewRow>(table: WritableTable, rows: NewRow[]): Promise<Row[]> {
  return apiRequest<Row[]>("POST", tablePath(table), rows);
}

/** Rejects with an ApiError: 404 if the tenant has no such row, 409 if other rows still reference it. */
export function deleteRow(table: WritableTable, id: string | number): Promise<void> {
  return apiRequest<void>("DELETE", `${tablePath(table)}/${encodeURIComponent(String(id))}`);
}
