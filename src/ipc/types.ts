// The TypeScript type of window.electronAPI, derived from the real services so it can't drift from
// them. Import it from UI code:  import type { ElectronApi } from "../ipc/types";
//   declare global { interface Window { electronAPI: ElectronApi } }
// Type-only imports: nothing here ends up in the preload bundle.
import type {
  localAccessoryService, localBrandService, localCatalogService, localCategoryService, localCustomerService, localDashboardService,
  localFrameService, localLabelService, localSalesService, localPaymentsService, localOrderDetailsService, localImageService, localInvoiceItemService, localInvoiceService, localLensService, localNumberService,
  localOrderItemService, localOrderService, localPaymentService, localPrescriptionService,
} from "../local";
import type { API_METHODS } from "./channels";

interface Services {
  brands: typeof localBrandService;
  categories: typeof localCategoryService;
  catalog: typeof localCatalogService;
  frames: typeof localFrameService;
  accessories: typeof localAccessoryService;
  customers: typeof localCustomerService;
  prescriptions: typeof localPrescriptionService;
  lenses: typeof localLensService;
  orders: typeof localOrderService;
  orderItems: typeof localOrderItemService;
  payments: typeof localPaymentService;
  invoices: typeof localInvoiceService;
  invoiceItems: typeof localInvoiceItemService;
  images: typeof localImageService;
  dashboard: typeof localDashboardService;
  labels: typeof localLabelService;
  sales: typeof localSalesService;
  paymentsView: typeof localPaymentsService;
  orderDetails: typeof localOrderDetailsService;
  numbers: typeof localNumberService;
}

/** Every method now returns a promise, because it crosses to the main process. */
type Async<T> = { [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never };

/** Only the methods listed in API_METHODS exist on the window. */
export type ElectronApi = { platform: string } & {
  [Name in keyof typeof API_METHODS]: Async<Pick<Services[Name], (typeof API_METHODS)[Name][number] & keyof Services[Name]>>;
};
