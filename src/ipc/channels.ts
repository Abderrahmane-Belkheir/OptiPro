// What the window (renderer) is allowed to call, as plain data. Both the main process
// (src/ipc/handlers.ts, which answers the calls) and the preload script (src/preload.ts, which
// builds window.electronAPI from it) read this list, so it must not import anything heavy: the
// preload runs next to the page and must never load the database.
//
// Only the local services are exposed - the window never talks to the backend directly. The sync
// bookkeeping columns never cross this boundary (see handlers.ts), and nothing that reads the
// tenant key from config.properties is exposed.

export const API_METHODS = {
  brands: ["list", "get", "insert", "insertMany", "update", "delete"],
  categories: ["list", "get"],
  /** Every category and brand as { id, name }, in one call: catalog.getCategoriesAndBrands(). */
  catalog: ["getCategoriesAndBrands"],
  frames: ["list", "search", "searchWithPhotos", "details", "listWithPhotos", "create", "edit", "delete", "usage", "get", "insert", "insertMany", "update", "remove"],
  accessories: ["list", "search", "details", "listWithPhotos", "create", "edit", "delete", "usage", "get", "insert", "insertMany", "update", "remove"],
  customers: ["list", "get", "search", "insert", "insertMany", "update", "delete"],
  /** A customer's history: listForCustomer(customerId) newest first; create(form) / edit(id, form) validate first (a prescription an order uses cannot be edited or deleted). */
  prescriptions: ["list", "get", "listForCustomer", "latestForCustomer", "create", "edit", "delete"],
  /** The lens catalog: listWithUsage() every lens with the order lines that use it; create(form) / edit(id, form) validate first; setActive(id, bool) retires or restores one; delete(id) only for one no order line uses. */
  lenses: ["list", "get", "listWithUsage", "create", "edit", "setActive", "availableFor", "delete"],
  orders: ["list", "get", "insert", "insertMany", "update"],
  orderItems: ["list", "get", "insert", "insertMany", "update"],
  payments: ["list", "get", "insert", "insertMany", "update"],
  invoices: ["list", "get", "insert", "insertMany", "update"],
  invoiceItems: ["list", "get", "insert", "insertMany", "update"],
  /** Photos of frames and accessories: upload(type, code, bytes[, photoId]) adds one photo to the frame/accessory with id `code` (type is "frame" or "accessory"; the photo's UUID is made up when not given); choose(type, code) opens a file picker and uploads each pick the same way. Needs a connection. */
  images: ["upload", "choose"],
  /** What the Dashboard page shows; read-only. */
  dashboard: ["month", "owed", "ready", "recentCustomers", "syncStatus"],
  /** The Sales page: list({ status, query, limit }) -> every order with its customer and money, the counts per status and the totals. Read-only. */
  sales: ["list"],
  /** The Reports page: overview({ year, month }) is the picture of a period (nothing = everything) compared with the one before; debtors() who owes money today; inventory() what the stock is worth today. Read-only. */
  reports: ["overview", "debtors", "inventory"],
  paymentsView: ["list"],
  orderDetails: ["get", "setStatus", "pay", "edit"],
  /** The New order form: place(draft) checks the draft, then saves the order, its lines and the deposit together; answers { status: "invalid", errors } or { status: "placed", order, ... }. */
  orderPlacement: ["place"],
  /** The orders placed with suppliers for frames: place(draft) saves one (a frame at stock 0 gets its stock and cost, the others wait), list() the orders newest first, get(id) one order with its lines. */
  supplierOrders: ["place", "list", "get", "searchProducts"],
  /** An order's printed papers: print(orderId, "invoice" | "lab", lang) opens the print dialog with the customer's invoice (issued on the first print, the same one after) or the lab sheet; issueInvoice(orderId) issues it without printing; html(orderId, kind, lang) is the page itself. */
  documents: ["print", "issueInvoice", "html", "labPdf", "savePdf"],
  /** Opens a message to a supplier in the browser: openEmail({ to, subject, message, file }) is Gmail's compose page, openWhatsApp({ phone, message, file }) a WhatsApp chat; both show the PDF in its folder (a link can not attach it). */
  contact: ["openEmail", "openWhatsApp"],
  /** The suppliers directory: list() by name (retired ones too); create(form) / edit(id, form) validate first and answer { status: "invalid", errors } or the saved supplier; setActive(id, bool) retires or restores one; delete(id) removes it here and on the server. */
  suppliers: ["list", "get", "create", "edit", "setActive", "delete"],
  /** The shop's own details (the Settings page): get() -> the saved details and whether the server has them; save(form) validates, saves only what differs from what is saved (an empty field means "leave it"), and sends it to the server; answers { status: "invalid", errors } | { status: "unchanged" } | { status: "saved", changed, sentToServer }; isPending() / pushPending() are what the sync pass uses. */
  shopInfo: ["get", "save", "isPending", "pushPending"],
  /** What goes on a product's label: qr(kind, code) -> { url, svg }; settings() -> the label size and printer; print({ kind, code, copies }) prints them; parseScan(text) reads what a scanner typed. */
  labels: ["qr", "settings", "print", "parseScan"],
  /** Printed document numbers: next("invoice") -> "FAC-2026-0042". */
  numbers: ["next", "list"],
} as const;

export type ApiName = keyof typeof API_METHODS;

export const channelFor = (api: string, method: string): string => `api:${api}:${method}`;

/** What a handler answers with. Errors travel as data so their details survive the trip. */
export type IpcResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { name: string; message: string; kind?: string } };
