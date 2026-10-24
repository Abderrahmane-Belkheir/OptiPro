import { randomUUID } from "node:crypto";
import { sqlitePrisma } from "../lib/sqliteClient";
import { currentTenantKey } from "./context";
import { docLang, invoiceHtml, labBundleHtml, labSheetHtml, type DocShop, type InvoiceDoc, type LabDoc, type LabEye } from "./documents";
import { LocalDbError } from "./errors";
import { localLicenseService } from "./licenseService";
import { localNumberService } from "./shopServices";
import { pushRow } from "./syncPush";

/**
 * Printing an order. Two documents, both made from the order as it was saved:
 *
 *   invoice   for the customer. The first time one is asked for, the invoice is ISSUED: it gets its number (FAC-2026-0042), a copy of the order's
 *             lines and total, the customer's name and address as they are today, and is saved (and sent to the server like any other row). Every
 *             later print is the SAME invoice with the same number; only what was paid, and what is left, is read again.
 *   lab       for the lab: the prescription as written, the lens, the measurements, the frame, the promised day. Nothing is saved: it is a printout
 *             of the order.
 *
 * The page goes to a printer plugged in by the app (src/documentPrinter.ts: the system's print dialog, where "save as PDF" is a printer too).
 */

export type DocumentKind = "invoice" | "lab";

export interface DocumentPrintResult {
  /** "sent": handed to the printer. "cancelled": the person closed the print dialog. "saved": written to a PDF file instead (tests only). */
  status: "sent" | "cancelled" | "saved";
  kind: DocumentKind;
  /** The invoice's number, or the order's number for the lab sheet. */
  number: string;
  file?: string;
}

/** Sends a finished page to a printer. Plugged in by the app at start; not part of this file so it can be tested without Electron. */
export type DocumentPrinter = (html: string, job: { kind: DocumentKind; number: string }) => Promise<{ status: "sent" | "cancelled" | "saved"; file?: string }>;

let printer: DocumentPrinter | null = null;
export function setDocumentPrinter(fn: DocumentPrinter | null): void {
  printer = fn;
}

/** Writes a finished page as a PDF file and answers where it is. Plugged in by the app at start (Electron), like the printer. */
export type PdfMaker = (html: string, name: string) => Promise<{ file: string }>;

let pdfMaker: PdfMaker | null = null;
export function setPdfMaker(fn: PdfMaker | null): void {
  pdfMaker = fn;
}

/** Lets the person keep a PDF this app made: asks where, copies it there, answers where it went (or that they cancelled). Plugged in by the app at start. */
export type PdfSaver = (file: string) => Promise<{ status: "saved" | "cancelled"; file?: string }>;

let pdfSaver: PdfSaver | null = null;
export function setPdfSaver(fn: PdfSaver | null): void {
  pdfSaver = fn;
}

/** The PDF files this run of the app made: the only ones the window can ask to have saved elsewhere (it can not name any other file). */
const madePdfs = new Map<string, { orderIds: string[]; numbers: string[]; lang: string }>();

/** Whether this file is a PDF this run of the app made (the only kind the window may ask to have saved, shown or sent). */
export function isMadePdf(file: string): boolean {
  return madePdfs.has(file);
}

/** The orders a PDF this app made holds (their ids and numbers, in the order of its pages), and the language it is written in; null for any other file. */
export function madePdfInfo(file: string): { orderIds: string[]; numbers: string[]; lang: string } | null {
  return madePdfs.get(file) ?? null;
}

/** The lab sheet of ONE order as a PDF file of its own (the file the PDF maker writes; the caller moves it where it belongs). */
export async function makeSheetPdf(orderId: string, lang: string): Promise<string> {
  if (pdfMaker === null) throw new LocalDbError("Documents: no PDF maker is available in this run of the app.", "invalid-input");
  const doc = await labDoc(orderId);
  return (await pdfMaker(labSheetHtml(doc, docLang(lang)), "lab-sheet")).file;
}

/** The most lab sheets one PDF can hold. */
export const MAX_LAB_PDF_ORDERS = 200;

export interface LabPdf {
  /** The PDF file that was written. */
  file: string;
  /** How many orders (lab sheets) are in it, and their numbers in the order of the pages. */
  orders: number;
  numbers: string[];
}

export interface IssuedInvoice {
  id: string;
  number: string;
  orderId: string;
  issuedAt: string;
  totalCents: number;
}

/** The shop's name and contact details: the ones saved with the licence at activation, else whatever the local shop row holds. */
async function shopDetails(tenantKey: string): Promise<DocShop> {
  const saved = await localLicenseService.getShop();
  const row = await sqlitePrisma.tenant.findFirst({ where: { key: tenantKey }, select: { name: true, phone: true, email: true, address: true } });
  // (the local row of a shop has its key as its name until the server's details are known: a key is not a name to print)
  const rowName = row && row.name !== tenantKey ? row.name : "";
  return { name: saved?.name ?? rowName, phone: saved?.phone ?? row?.phone ?? null, email: saved?.email ?? row?.email ?? null, address: saved?.address ?? row?.address ?? null };
}

async function loadOrder(orderId: unknown, tenantKey: string) {
  if (typeof orderId !== "string" || !orderId) throw new LocalDbError("Documents: give the order's id.", "invalid-input");
  const order = await sqlitePrisma.order.findFirst({ where: { id: orderId, tenantKey } });
  if (!order) throw new LocalDbError(`Documents: no order "${orderId}".`, "not-found");
  return order;
}

const issuing = new Map<string, Promise<IssuedInvoice>>();

async function issue(orderId: string, tenantKey: string): Promise<IssuedInvoice> {
  const order = await loadOrder(orderId, tenantKey);
  const toIssued = (inv: { id: string; number: string; orderId: string | null; issuedAt: Date; totalCents: number }): IssuedInvoice => ({ id: inv.id, number: inv.number, orderId: orderId, issuedAt: inv.issuedAt.toISOString(), totalCents: inv.totalCents });
  const existing = await sqlitePrisma.invoice.findFirst({ where: { orderId, tenantKey, kind: "invoice" }, orderBy: { createdAt: "asc" } });
  if (existing) return toIssued(existing);
  if (order.status === "cancelled") throw new LocalDbError("Invoice: this order is cancelled, it has no invoice.", "invalid-input");

  const [customer, items] = await Promise.all([
    order.customerId ? sqlitePrisma.customer.findFirst({ where: { id: order.customerId, tenantKey }, select: { name: true, address: true } }) : null,
    sqlitePrisma.orderItem.findMany({ where: { orderId, tenantKey }, orderBy: { createdAt: "asc" } }),
  ]);
  if (items.length === 0) throw new LocalDbError("Invoice: this order has no lines.", "invalid-input");

  // The number is saved before the invoice: a number is never reused, so a failure below leaves a gap, never a duplicate.
  const number = await localNumberService.next("invoice");
  const id = randomUUID();
  const lineIds = items.map(() => randomUUID());
  await sqlitePrisma.$transaction(async (tx) => {
    await tx.invoice.create({
      data: {
        id, number, tenantKey, kind: "invoice", orderId, customerId: order.customerId, issuedAt: new Date(),
        subtotalCents: order.subtotalCents, discountCents: order.discountCents, vatCents: 0, totalCents: order.totalCents,
        customerName: customer?.name ?? null, customerAddress: customer?.address ?? null,
      },
    });
    for (const [index, item] of items.entries()) {
      await tx.invoiceItem.create({ data: { id: lineIds[index], invoiceId: id, tenantKey, description: item.description, quantity: item.quantity, unitPriceCents: item.unitPriceCents, totalCents: item.totalCents } });
    }
  });
  await pushRow("invoices", id);
  for (const lineId of lineIds) await pushRow("invoice_items", lineId);
  const saved = await sqlitePrisma.invoice.findFirst({ where: { id, tenantKey } });
  return toIssued(saved!);
}

/** Two prints at once (a double click) issue ONE invoice: the second waits for the first. */
function issueOnce(orderId: string, tenantKey: string): Promise<IssuedInvoice> {
  let promise = issuing.get(orderId);
  if (!promise) {
    promise = issue(orderId, tenantKey).finally(() => issuing.delete(orderId));
    issuing.set(orderId, promise);
  }
  return promise;
}

/** The invoice document of an order (issuing the invoice first if it has none). */
export async function invoiceDoc(orderId: string): Promise<InvoiceDoc> {
  const tenantKey = await currentTenantKey();
  await loadOrder(orderId, tenantKey);
  const issued = await issueOnce(orderId, tenantKey);
  const [invoice, lines, payments, order] = await Promise.all([
    sqlitePrisma.invoice.findFirst({ where: { id: issued.id, tenantKey } }),
    sqlitePrisma.invoiceItem.findMany({ where: { invoiceId: issued.id, tenantKey }, orderBy: { createdAt: "asc" } }),
    sqlitePrisma.payment.findMany({ where: { orderId, tenantKey }, select: { amountCents: true } }),
    sqlitePrisma.order.findFirst({ where: { id: orderId, tenantKey }, select: { number: true, customerId: true } }),
  ]);
  const phone = order?.customerId ? (await sqlitePrisma.customer.findFirst({ where: { id: order.customerId, tenantKey }, select: { phone: true } }))?.phone ?? null : null;
  const paidCents = payments.reduce((sum, p) => sum + p.amountCents, 0);
  return {
    shop: await shopDetails(tenantKey),
    number: invoice!.number,
    orderNumber: order!.number,
    issuedAt: invoice!.issuedAt.toISOString(),
    customer: invoice!.customerName ? { name: invoice!.customerName, phone, address: invoice!.customerAddress } : null,
    lines: lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPriceCents: l.unitPriceCents, totalCents: l.totalCents })),
    subtotalCents: invoice!.subtotalCents,
    discountCents: invoice!.discountCents,
    totalCents: invoice!.totalCents,
    paidCents,
    balanceCents: Math.max(0, invoice!.totalCents - paidCents),
  };
}

/** The lab sheet of an order: nothing is saved. */
export async function labDoc(orderId: string): Promise<LabDoc> {
  const tenantKey = await currentTenantKey();
  const order = await loadOrder(orderId, tenantKey);
  const [customer, prescription, items] = await Promise.all([
    order.customerId ? sqlitePrisma.customer.findFirst({ where: { id: order.customerId, tenantKey }, select: { name: true } }) : null,
    order.prescriptionId ? sqlitePrisma.prescription.findFirst({ where: { id: order.prescriptionId, tenantKey } }) : null,
    sqlitePrisma.orderItem.findMany({ where: { orderId, tenantKey }, orderBy: { createdAt: "asc" } }),
  ]);
  const eye = (side: "right" | "left", rx: NonNullable<typeof prescription>): LabEye =>
    side === "right"
      ? { sphere: rx.rightSphere, cylinder: rx.rightCylinder, axis: rx.rightAxis, add: rx.rightAdd }
      : { sphere: rx.leftSphere, cylinder: rx.leftCylinder, axis: rx.leftAxis, add: rx.leftAdd };

  const lenses: LabDoc["lenses"] = [];
  for (const item of items.filter((i) => i.kind === "lens")) {
    const lens = item.lensId ? await sqlitePrisma.lens.findFirst({ where: { id: item.lensId, tenantKey } }) : null;
    lenses.push({
      description: item.description,
      spec: lens ? { design: lens.design, material: lens.material, refractiveIndex: lens.refractiveIndex, antiReflective: lens.antiReflective, blueLightFilter: lens.blueLightFilter, photochromic: lens.photochromic, polarized: lens.polarized, tint: lens.tint } : null,
    });
  }
  const frameItem = items.find((i) => i.kind === "frame");
  const frame = frameItem?.frameId ? await sqlitePrisma.frame.findFirst({ where: { id: frameItem.frameId, tenantKey } }) : null;

  return {
    orderId: order.id,
    shop: await shopDetails(tenantKey),
    orderNumber: order.number,
    orderedAt: order.orderedAt.toISOString(),
    promisedAt: order.promisedAt?.toISOString() ?? null,
    customerName: customer?.name ?? null,
    prescription: prescription ? { prescribedAt: prescription.prescribedAt.toISOString(), prescriberName: prescription.prescriberName, right: eye("right", prescription), left: eye("left", prescription), notes: prescription.notes } : null,
    measurements: { pdRight: order.pdRight, pdLeft: order.pdLeft, fittingHeightRight: order.fittingHeightRight, fittingHeightLeft: order.fittingHeightLeft },
    lenses,
    frame: frameItem ? { description: frameItem.description, code: frame?.code ?? null, reference: frame?.reference ?? null, eyeSize: frame?.eyeSize ?? null, bridge: frame?.bridge ?? null, templeLength: frame?.templeLength ?? null } : null,
    notes: order.notes,
  };
}

export const localDocumentService = {
  /** Issues the order's invoice if it has none yet and answers it (the same one every time). Refused for a cancelled order. */
  async issueInvoice(orderId: string): Promise<IssuedInvoice> {
    const tenantKey = await currentTenantKey();
    await loadOrder(orderId, tenantKey);
    return issueOnce(orderId, tenantKey);
  },

  /** The page as HTML, without printing it (for a preview, and for tests). lang: "en" | "fr" | "ar". */
  async html(orderId: string, kind: DocumentKind, lang?: string): Promise<string> {
    if (kind !== "invoice" && kind !== "lab") throw new LocalDbError(`Documents: kind must be "invoice" or "lab".`, "invalid-input");
    return kind === "invoice" ? invoiceHtml(await invoiceDoc(orderId), docLang(lang)) : labSheetHtml(await labDoc(orderId), docLang(lang));
  },

  /**
   * The lab sheets of these orders in ONE PDF file, one sheet per page, in the order given (a cancelled order or an order with no lens is refused,
   * with the number of the order). Nothing is saved or sent: the file is only made.
   */
  async labPdf(orderIds: unknown, lang?: string): Promise<LabPdf> {
    if (!Array.isArray(orderIds) || orderIds.length === 0 || orderIds.some((id) => typeof id !== "string" || !id)) {
      throw new LocalDbError("Documents: give the ids of the orders.", "invalid-input");
    }
    const ids = [...new Set(orderIds as string[])];
    if (ids.length > MAX_LAB_PDF_ORDERS) throw new LocalDbError(`Documents: at most ${MAX_LAB_PDF_ORDERS} orders in one PDF.`, "invalid-input");
    if (pdfMaker === null) throw new LocalDbError("Documents: no PDF maker is available in this run of the app.", "invalid-input");
    const docs: LabDoc[] = [];
    for (const id of ids) docs.push(await labDoc(id));
    const without = docs.find((d) => d.lenses.length === 0);
    if (without) throw new LocalDbError(`Order ${without.orderNumber} has no lens: there is nothing to send to a lens supplier.`, "invalid-input");
    const { file } = await pdfMaker(labBundleHtml(docs, docLang(lang)), "lab-orders");
    madePdfs.set(file, { orderIds: docs.map((d) => d.orderId), numbers: docs.map((d) => d.orderNumber), lang: docLang(lang) });
    return { file, orders: docs.length, numbers: docs.map((d) => d.orderNumber) };
  },

  /** Saves a lab PDF that labPdf made where the person chooses on this computer (a "save as" window). Any other file is refused. */
  async savePdf(file: unknown): Promise<{ status: "saved" | "cancelled"; file?: string }> {
    if (typeof file !== "string" || !madePdfs.has(file)) throw new LocalDbError("Documents: that is not a PDF this app made.", "invalid-input");
    if (pdfSaver === null) throw new LocalDbError("Documents: saving a PDF is not available in this run of the app.", "invalid-input");
    return pdfSaver(file);
  },

  /** Prints the invoice (the customer's copy) or the lab sheet of an order, in the language given. Answers what the printer did. */
  async print(orderId: string, kind: DocumentKind, lang?: string): Promise<DocumentPrintResult> {
    if (kind !== "invoice" && kind !== "lab") throw new LocalDbError(`Documents: kind must be "invoice" or "lab".`, "invalid-input");
    if (printer === null) throw new LocalDbError("Documents: no printer is available in this run of the app.", "invalid-input");
    const language = docLang(lang);
    const doc = kind === "invoice" ? await invoiceDoc(orderId) : await labDoc(orderId);
    const number = kind === "invoice" ? (doc as InvoiceDoc).number : (doc as LabDoc).orderNumber;
    const html = kind === "invoice" ? invoiceHtml(doc as InvoiceDoc, language) : labSheetHtml(doc as LabDoc, language);
    const outcome = await printer(html, { kind, number });
    return { ...outcome, kind, number };
  },
};
