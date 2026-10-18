import type {
  Accessory, Brand, Category, Customer, Frame, Invoice, InvoiceItem, Lens, NewAccessory, NewBrand, NewCustomer, NewFrame,
  NewInvoice, NewInvoiceItem, NewLens, NewOrder, NewOrderItem, NewPayment, NewPrescription, Order, OrderItem, Payment, Prescription,
} from "../services/types";

/** The two databases the app can work with. */
export type DatabaseName = "local" | "remote";

/** Every table that has the full table API, with the shape of its rows and of a new row. */
export interface TableTypes {
  brands: { row: Brand; input: NewBrand };
  frames: { row: Frame; input: NewFrame };
  accessories: { row: Accessory; input: NewAccessory };
  customers: { row: Customer; input: NewCustomer };
  prescriptions: { row: Prescription; input: NewPrescription };
  lenses: { row: Lens; input: NewLens };
  orders: { row: Order; input: NewOrder };
  order_items: { row: OrderItem; input: NewOrderItem };
  payments: { row: Payment; input: NewPayment };
  invoices: { row: Invoice; input: NewInvoice };
  invoice_items: { row: InvoiceItem; input: NewInvoiceItem };
}

export type TableName = keyof TableTypes;

export const TABLE_NAMES: TableName[] = [
  "brands", "frames", "accessories", "customers", "prescriptions", "lenses", "orders", "order_items", "payments", "invoices", "invoice_items",
];

/**
 * What every table offers, on either database. Rows come back in the app's shape: field names in
 * camelCase, dates as ISO strings, array columns as arrays. Failures that the caller can act on are
 * thrown as LocalDbError with a `kind` (not-found, duplicate, invalid-reference, invalid-input).
 * Method syntax on purpose: an implementation may accept a narrower argument type (a brand id is a
 * number, every other id a string).
 */
export interface TableApi<Row, New> {
  /** Optionally narrowed to rows whose columns equal `filter`, e.g. { orderId }. */
  list(filter?: Record<string, string | number | boolean>): Promise<Row[]>;
  get(id: string | number): Promise<Row | null>;
  insert(row: New): Promise<Row>;
  /** All the rows or none of them. */
  insertMany(rows: New[]): Promise<Row[]>;
  /** Only the fields given change. */
  update(id: string | number, changes: Partial<New>): Promise<Row>;
  remove(id: string | number): Promise<void>;
}

export interface Database {
  readonly name: DatabaseName;
  table<K extends TableName>(name: K): TableApi<TableTypes[K]["row"], TableTypes[K]["input"]>;
  /** Categories are global and read-only here. */
  readonly categories: { list(): Promise<Category[]> };
}

/** The database on this computer. Writes are scoped to the shop, mark rows unsynced and are pushed to the remote one. */
export type LocalDatabase = Database;

/** The shared Neon database. Only reachable with a connection; offline calls reject with RemoteUnreachableError. */
export interface RemoteDatabase extends Database {
  ping(): Promise<void>;
  fetchTenants(): Promise<{ key: string; host: string; name: string }[]>;
  /** Inserts the rows or updates those whose id exists, in one transaction. Used by the sync layer. */
  upsertMany(tenantKey: string, table: string, rows: Record<string, unknown>[]): Promise<void>;
  /** Brands have a database-assigned id: insert (no id) returns it, with an id renames that brand. */
  saveBrand(tenantKey: string, brand: { id?: number; name: string }): Promise<{ id: number }>;
  close(): Promise<void>;
}
