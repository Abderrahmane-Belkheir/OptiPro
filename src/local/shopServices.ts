import { sqlitePrisma } from "../lib/sqliteClient";
import {
  invoiceItemService, invoiceService, lensService, numberSequenceService, orderItemService, orderService,
  paymentService, prescriptionService,
} from "../services/shopServices";
import type {
  Invoice, InvoiceItem, Lens, NewInvoice, NewInvoiceItem, NewLens, NewOrder, NewOrderItem, NewPayment,
  NewPrescription, NumberSequence, Order, OrderItem, Payment, Prescription,
} from "../services/types";
import { currentTenantKey } from "./context";
import { parentsOf } from "./syncParents";
import { pushRow } from "./syncPush";
import { createLocalTableService } from "./tableService";

export const localPrescriptionService = createLocalTableService<Prescription, NewPrescription>({
  table: "prescriptions",
  label: "prescription",
  delegate: "prescription",
  remote: prescriptionService,
  dateFields: ["prescribedAt"],
  parents: parentsOf("prescriptions"),
  orderBy: { prescribedAt: "desc" },
});

export const localLensService = createLocalTableService<Lens, NewLens>({
  table: "lenses",
  label: "lens",
  delegate: "lens",
  remote: lensService,
  orderBy: { name: "asc" },
});

export const localOrderService = createLocalTableService<Order, NewOrder>({
  table: "orders",
  label: "order",
  delegate: "order",
  remote: orderService,
  dateFields: ["orderedAt", "promisedAt", "deliveredAt"],
  parents: parentsOf("orders"),
  orderBy: { orderedAt: "desc" },
});

export const localOrderItemService = createLocalTableService<OrderItem, NewOrderItem>({
  table: "order_items",
  label: "order item",
  delegate: "orderItem",
  remote: orderItemService,
  parents: parentsOf("order_items"),
  orderBy: { createdAt: "asc" },
});

export const localPaymentService = createLocalTableService<Payment, NewPayment>({
  table: "payments",
  label: "payment",
  delegate: "payment",
  remote: paymentService,
  dateFields: ["paidAt", "chequeDueDate"],
  parents: parentsOf("payments"),
  orderBy: { paidAt: "desc" },
});

export const localInvoiceService = createLocalTableService<Invoice, NewInvoice>({
  table: "invoices",
  label: "invoice",
  delegate: "invoice",
  remote: invoiceService,
  dateFields: ["issuedAt"],
  parents: parentsOf("invoices"),
  orderBy: { issuedAt: "desc" },
});

export const localInvoiceItemService = createLocalTableService<InvoiceItem, NewInvoiceItem>({
  table: "invoice_items",
  label: "invoice line",
  delegate: "invoiceItem",
  remote: invoiceItemService,
  parents: parentsOf("invoice_items"),
  orderBy: { createdAt: "asc" },
});

// ---- Document numbers ---------------------------------------------------------------------------

const sequenceService = createLocalTableService<NumberSequence, never>({
  table: "number_sequences",
  label: "number sequence",
  delegate: "numberSequence",
  remote: numberSequenceService,
  orderBy: { year: "desc" },
});

const DEFAULT_PREFIXES: Record<string, string> = { order: "CMD", invoice: "FAC", quote: "DEV", delivery_note: "BL" };

export const localNumberService = {
  /**
   * The next printed number for `kind`, e.g. "FAC-2026-0042", counting up per tenant, kind, year and
   * `series`. Give each computer that issues documents offline its own `series` (say "A", "B") so two
   * of them can never produce the same number; it then appears in the number: "FAC-A-2026-0042".
   * The counter is saved first and the number only returned afterwards, so a number is never reused.
   */
  async next(kind: string, options: { year?: number; series?: string; prefix?: string } = {}): Promise<string> {
    const tenantKey = await currentTenantKey();
    const year = options.year ?? new Date().getFullYear();
    const series = options.series ?? "";
    const prefix = options.prefix ?? DEFAULT_PREFIXES[kind] ?? kind.toUpperCase();

    const sequence = await sqlitePrisma.numberSequence.upsert({
      where: { tenantKey_kind_year_series: { tenantKey, kind, year, series } },
      create: { tenantKey, kind, year, series, prefix, lastNumber: 1 },
      update: { lastNumber: { increment: 1 }, synced: false },
    });
    await pushRow("number_sequences", sequence.id);

    return [sequence.prefix, series, String(year), String(sequence.lastNumber).padStart(4, "0")].filter(Boolean).join("-");
  },

  list: () => sequenceService.list(),
};
