// What the window (renderer) is allowed to call, as plain data. Both the main process
// (src/ipc/handlers.ts, which answers the calls) and the preload script (src/preload.ts, which
// builds window.electronAPI from it) read this list, so it must not import anything heavy: the
// preload runs next to the page and must never load the database.
//
// Only the local services are exposed - the window never talks to the backend directly. Syncing runs
// in the background (src/local/syncScheduler.ts) and is deliberately invisible to the UI: nothing
// about pushing is exposed here, and the sync bookkeeping columns never cross this boundary (see
// handlers.ts). Internal methods (pushRows) are left out too, and so is anything that reads the
// tenant key or the server address from config.properties.

export const API_METHODS = {
  brands: ["list", "get", "insert", "update", "remove"],
  categories: ["list", "get", "replaceAll"],
  frames: ["list", "get", "insert", "insertMany", "update", "remove"],
  accessories: ["list", "get", "insert", "insertMany", "update", "remove"],
  customers: ["list", "get", "search", "insert", "insertMany", "update", "remove"],
  prescriptions: ["list", "get", "insert", "insertMany", "update", "remove"],
  lenses: ["list", "get", "insert", "insertMany", "update", "remove"],
  orders: ["list", "get", "insert", "insertMany", "update", "remove"],
  orderItems: ["list", "get", "insert", "insertMany", "update", "remove"],
  payments: ["list", "get", "insert", "insertMany", "update", "remove"],
  invoices: ["list", "get", "insert", "insertMany", "update", "remove"],
  invoiceItems: ["list", "get", "insert", "insertMany", "update", "remove"],
  /** Printed document numbers: next("invoice") -> "FAC-2026-0042". */
  numbers: ["next", "list"],
} as const;

export type ApiName = keyof typeof API_METHODS;

export const channelFor = (api: string, method: string): string => `api:${api}:${method}`;

/** What a handler answers with. Errors travel as data so their details survive the trip. */
export type IpcResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { name: string; message: string; kind?: string } };
