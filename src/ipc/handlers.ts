import { ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  ImageUploadError, LocalDbError, localAccessoryService, localBrandService, localCatalogService, localCategoryService, localCustomerService, localDashboardService,
  localFrameService, localLabelService, localSalesService, localPaymentsService, localOrderDetailsService, localImageService, localInvoiceItemService, localInvoiceService, localLensService, localNumberService,
  localOrderItemService, localOrderService, localPaymentService, localPrescriptionService,
} from "../local";
import { API_METHODS, channelFor, type ApiName, type IpcResult } from "./channels";

type AnyFunction = (...args: unknown[]) => unknown;

/** The real service behind each name in API_METHODS. */
const services: Record<ApiName, Record<string, AnyFunction>> = {
  brands: localBrandService,
  categories: localCategoryService,
  catalog: localCatalogService,
  frames: localFrameService,
  accessories: localAccessoryService,
  customers: localCustomerService,
  prescriptions: localPrescriptionService,
  lenses: localLensService,
  orders: localOrderService,
  orderItems: localOrderItemService,
  payments: localPaymentService,
  invoices: localInvoiceService,
  invoiceItems: localInvoiceItemService,
  images: localImageService,
  dashboard: localDashboardService,
  labels: localLabelService,
  sales: localSalesService,
  paymentsView: localPaymentsService,
  orderDetails: localOrderDetailsService,
  numbers: localNumberService,
} as unknown as Record<ApiName, Record<string, AnyFunction>>;

/**
 * The sync bookkeeping columns. The background sync owns them: the window never sees them in a
 * result and can never set them from an input (a row saved with synced: true would claim the
 * backend has it when nothing was sent).
 */
const SYNC_COLUMNS = ["synced"];

/** A copy of the value with the sync columns removed from every row in it (a row, or a list of rows). */
function withoutSyncColumns(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSyncColumns);
  // Only plain objects are rows; bytes (an image being uploaded), dates and the like pass through untouched.
  if (value && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !SYNC_COLUMNS.includes(key)));
  }
  return value;
}

function describeError(err: unknown): { name: string; message: string; kind?: string } {
  if (err instanceof LocalDbError || err instanceof ImageUploadError) return { name: err.name, message: err.message, kind: err.kind };
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { name: "Error", message: String(err) };
}

/**
 * Answers every call in API_METHODS over IPC: one channel per method, "api:<service>:<method>".
 * Only calls from a page that `isTrusted` approves are served — the app's own window, not an
 * iframe or anything it navigated to. Registers once; call it before the window is created.
 */
export function registerIpcHandlers(isTrusted: (event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">) => boolean): void {
  // The preload script (sandboxed, so it can't import the list) asks for it once, synchronously.
  ipcMain.on("api:describe", (event) => {
    event.returnValue = isTrusted(event) ? API_METHODS : {};
  });

  for (const [name, methods] of Object.entries(API_METHODS)) {
    const service = services[name as ApiName];
    for (const method of methods) {
      if (typeof service?.[method] !== "function") {
        throw new Error(`API_METHODS lists ${name}.${method}, but that service has no such method.`);
      }
      ipcMain.handle(channelFor(name, method), async (event, ...args): Promise<IpcResult> => {
        if (!isTrusted(event)) return { ok: false, error: { name: "Error", message: "Call refused: untrusted sender." } };
        try {
          return { ok: true, value: withoutSyncColumns(await service[method](...args.map(withoutSyncColumns))) };
        } catch (err) {
          // Expected failures (a missing row, a duplicate number, a missing config) go back to the
          // window as data; anything else is a bug worth seeing in the terminal too.
          if (!(err instanceof LocalDbError) && !(err instanceof ImageUploadError) && !(err instanceof Error && err.name === "ConfigError")) {
            console.error(`[ipc] ${name}.${method} failed:`, err);
          }
          return { ok: false, error: describeError(err) };
        }
      });
    }
  }
}
