import {
  localAccessoryService, localBrandService, localCategoryService, localCustomerService, localFrameService, localInvoiceItemService,
  localInvoiceService, localLensService, localOrderItemService, localOrderService, localPaymentService, localPrescriptionService,
} from "../local";
import type { LocalDatabase, TableApi, TableName, TableTypes } from "./types";

/**
 * The local database as a `Database`: each table is the existing local service, so everything those
 * do still applies — scoping to the shop, parent checks, the `synced` flag, and pushing every write
 * to the remote database (see src/local/syncPush.ts).
 */
const tables = {
  brands: localBrandService,
  frames: localFrameService,
  accessories: localAccessoryService,
  customers: localCustomerService,
  prescriptions: localPrescriptionService,
  lenses: localLensService,
  orders: localOrderService,
  order_items: localOrderItemService,
  payments: localPaymentService,
  invoices: localInvoiceService,
  invoice_items: localInvoiceItemService,
} as unknown as { [K in TableName]: TableApi<TableTypes[K]["row"], TableTypes[K]["input"]> };

export const localDatabase: LocalDatabase = {
  name: "local",
  table: (name) => tables[name],
  categories: localCategoryService,
};
