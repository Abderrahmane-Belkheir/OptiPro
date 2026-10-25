export { LocalDbError } from "./errors";
export { localAccessoryService } from "./accessoryService";
export { localBrandService } from "./brandService";
export { localCatalogService, type CatalogEntry, type CategoriesAndBrands } from "./catalogService";
export { countUploadablePhotos, localPhotoService, MAX_PHOTOS_PER_PASS, pushPendingPhotos, sweepOrphanPhotoFiles, type PhotoPushResult } from "./photoService";
export { localCategoryService } from "./categoryService";
export { attemptDeletion, countPendingDeletions, MAX_DELETIONS_PER_PASS, pushPendingDeletions, queueDeletion, type DeletionPushResult } from "./pendingDeletions";
export { callTable, resetTableApiCircuit, type TableAction, type TableCallResult } from "./tableApiClient";
export { deleteOnServer, type DeletionKind, type ServerDeleteOutcome } from "./serverDelete";
export { seedCategories, STATIC_CATEGORIES } from "./staticCategories";
export { localCustomerService } from "./customerService";
export { ensureProductCodes, newProductCode, normalizeCode, randomCode, type ProductKind } from "./productCodes";
export { localFrameService } from "./frameService";
export { localSalesService, ORDER_STATUSES, type OrderStatus, type SaleRow, type SalesList } from "./salesService";
export { localLicenseService, type ShopDetails, type ShopInput } from "./licenseService";
export { localShopInfoService, postInfos, SHOP_INFO_TIMEOUT_MS, type InfosOutcome, type SaveShopInfoResult, type ShopInfo, type ShopInfoPushResult } from "./shopInfoService";
export { validateShopInfoForm, SHOP_INFO_FIELDS, type ShopInfoField, type ShopInfoForm } from "./shopInfoValidation";
export { setUnauthorizedHandler } from "./licenseGuard";
export { checkExpiryWithServer, checkKeyWithServer, type ExpiryCheck } from "./licenseCheck";
export { localPaymentsService, type PaymentRow, type PaymentsList } from "./paymentsService";
export { localOrderDetailsService, type OrderDetails, type OrderLine, type OrderPayment } from "./orderDetails";
export { localOrderPlacementService, type PlaceOrderResult } from "./orderPlacement";
export { localSupplierOrderPlacementService, type PlaceSupplierOrderResult, type SupplierOrderDraft } from "./supplierOrderPlacement";
export { localSupplierOrdersService, type SupplierOrderDetails, type SupplierOrderLine, type SupplierOrderRow, type SupplierOrdersList } from "./supplierOrderService";
export { localSupplierService, type SaveSupplierResult } from "./supplierService";
export { validateSupplierForm, kindsOf, SUPPLIER_KINDS, type CleanSupplier, type SupplierForm, type SupplierKind } from "./supplierValidation";
export { localDocumentService, setDocumentPrinter, setPdfMaker, setPdfSaver, invoiceDoc, labDoc, type DocumentKind, type DocumentPrinter, type DocumentPrintResult, type LabPdf, type PdfMaker, type PdfSaver, type IssuedInvoice } from "./documentService";
export { invoiceHtml, labSheetHtml, docLang, DOC_LANGS, type DocLang, type InvoiceDoc, type LabDoc } from "./documents";
export { validateOrderDraft, LENS_DESCRIPTION_MAX, MAX_AMOUNT_CENTS, ORDER_NOTES_MAX, type CleanDraft, type OrderDraft } from "./orderDraft";
export { labelGeometry, labelSettings, labelsHtml, localLabelService, parseScan, setLabelPrinter, MAX_COPIES, MIN_DOTS_PER_MODULE, MIN_QR_MM, qrModuleCount, type LabelPrinter, type LabelSettings, type PrintResult, type ProductQr, type ScannedCode } from "./labelService";
export { frameDetails, SOLD_WINDOW_DAYS, type FrameDetails } from "./frameDetails";
export { accessoryDetails, type AccessoryDetails } from "./accessoryDetails";
export { searchAccessories, searchFrames, type ProductHit } from "./productSearch";
export { ImageUploadError, localImageService, uploadFiles, MAX_IMAGE_BYTES, PRODUCT_TYPES, type ProductType, type ImageUploadErrorKind, type UploadBatch, type UploadedImage } from "./imageService";
export {
  localInvoiceItemService, localInvoiceService, localLensService, localNumberService, localOrderItemService,
  localOrderService, localPaymentService, localPrescriptionService, localSupplierOrderItemService, localSupplierOrderService,
} from "./shopServices";
export { localContactService, setExternalOpener, whatsappNumber, type ExternalOpener, type OpenResult } from "./contactService";
export { syncFlag } from "./sync";
export { localReportsService, type ReportsOverview, type ReportHeadline, type ReportDebtors, type ReportInventory } from "./reportsService";
export { localDashboardService, type DashboardMonth, type DashboardOwed, type DashboardReady, type ReadyOrder, type SyncStatus } from "./dashboardService";
export { lastGoodSyncRun, lastSyncRun, pushAll, startSyncScheduler, stopSyncScheduler, SYNC_INTERVAL_MS, type SyncRun } from "./syncScheduler";
export { pushRow, pushTable, SYNC_ORDER, type PushRowResult, type PushTableResult, type SyncTable } from "./syncPush";
export { checkUnsynced, syncState, type UnsyncedRow } from "./syncStatus";
export { validatePrescriptionForm, type CleanPrescription, type PrescriptionForm } from "./prescriptionValidation";
export type { LensEntry, PrescriptionEntry, SaveLensResult, SavePrescriptionResult } from "./shopServices";
export { validateLensForm, toCode, type CleanLens, type LensForm } from "./lensValidation";
export {
  matchLenses, toMinusCylinder, toPlusCylinder, transposeAxis, strongestMeridian, lensCylinderSign, formatDiopters,
  type BothEyesFit, type CylinderForm, type Eye, type EyeMatch, type Finding, type LensExclusion, type LensFit, type LensLike, type LensMatch, type MatchOptions, type PrescriptionInput,
} from "./lensMatching";
