import { sqlitePrisma } from "../lib/sqliteClient";
import type {
  Invoice, InvoiceItem, Lens, NewInvoice, NewInvoiceItem, NewLens, NewOrder, NewOrderItem, NewPayment,
  NewPrescription, NumberSequence, Order, OrderItem, Payment, Prescription,
} from "../services/types";
import { currentTenantKey } from "./context";
import { parentsOf } from "./syncParents";
import { pushRow } from "./syncPush";
import { LocalDbError } from "./errors";
import type { FieldErrors } from "./frameValidation";
import { validatePrescriptionForm, type PrescriptionForm } from "./prescriptionValidation";
import { validateLensForm, type LensForm } from "./lensValidation";
import { createLocalTableService } from "./tableService";

const prescriptionTable = createLocalTableService<Prescription, NewPrescription>({
  table: "prescriptions",
  label: "prescription",
  delegate: "prescription",
  dateFields: ["prescribedAt"],
  parents: parentsOf("prescriptions"),
  orderBy: { prescribedAt: "desc" },
  // Once an order uses a prescription it is a record of what was ordered: it cannot be changed any more (a new exam is a new prescription).
  guardUpdate: async (id, tenantKey) => {
    const orders = await sqlitePrisma.order.count({ where: { prescriptionId: id, tenantKey } });
    if (orders > 0) throw new LocalDbError(`This prescription is used by ${orders} ${orders === 1 ? "order" : "orders"}, so it cannot be changed. Create a new prescription instead.`, "invalid-input");
  },
  // Deletable, but never while an order uses it (orders.prescription_id is RESTRICT here and on the server).
  syncedDelete: {
    kind: "prescription",
    usedBy: (id, tenantKey) => sqlitePrisma.order.count({ where: { prescriptionId: id, tenantKey } }),
    usedMessage: (_row, count) => `This prescription is used by ${count} ${count === 1 ? "order" : "orders"}, so it cannot be deleted.`,
    name: (row) => `Prescription of ${new Date(row.prescribedAt as Date).toISOString().slice(0, 10)}`,
  },
});

/** One line of a customer's history. */
export type PrescriptionEntry = Prescription & {
  /** How many orders use it. */
  usedByOrders: number;
  /** The newest one of the customer (by the date written on it): the one to offer first. */
  current: boolean;
  /** False once an order uses it: it can no longer be changed or deleted. */
  editable: boolean;
};

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : value);

/** A customer's prescriptions, newest first (the date written on it, then the day it was entered). */
async function historyOf(customerId: string): Promise<PrescriptionEntry[]> {
  const tenantKey = await currentTenantKey();
  const rows = await sqlitePrisma.prescription.findMany({ where: { customerId, tenantKey }, orderBy: [{ prescribedAt: "desc" }, { createdAt: "desc" }, { id: "asc" }] });
  const used = rows.length ? await sqlitePrisma.order.groupBy({ by: ["prescriptionId"], where: { tenantKey, prescriptionId: { in: rows.map((r) => r.id) } }, _count: { _all: true } }) : [];
  const counts = new Map(used.map((u) => [u.prescriptionId, u._count._all]));
  return rows.map((row, index) => {
    const usedByOrders = counts.get(row.id) ?? 0;
    return Object.fromEntries(Object.entries({ ...row, usedByOrders, current: index === 0, editable: usedByOrders === 0 }).map(([k, v]) => [k, iso(v)])) as unknown as PrescriptionEntry;
  });
}

/** What `create` / `edit` answer: the form's mistakes (nothing was saved), or the saved prescription and whether the server has it. */
export type SavePrescriptionResult =
  | { status: "invalid"; errors: FieldErrors }
  | { status: "created" | "updated"; prescription: Prescription; sentToServer: boolean };

export const localPrescriptionService = {
  ...prescriptionTable,

  /** A customer's history, newest first. */
  listForCustomer: historyOf,

  /** The newest prescription of the customer, or null when they have none. */
  async latestForCustomer(customerId: string): Promise<PrescriptionEntry | null> {
    return (await historyOf(customerId))[0] ?? null;
  },

  /** Saves a new prescription for a customer (a new exam is always a new row): validated first, then saved and sent like any other row. */
  async create(form: PrescriptionForm): Promise<SavePrescriptionResult> {
    const checked = validatePrescriptionForm(form);
    if (checked.errors) return { status: "invalid", errors: checked.errors };
    const tenantKey = await currentTenantKey();
    if (!(await sqlitePrisma.customer.findFirst({ where: { id: checked.prescription.customerId, tenantKey }, select: { id: true } }))) {
      return { status: "invalid", errors: { customerId: "This customer no longer exists." } };
    }
    const prescription = await prescriptionTable.insert(checked.prescription as unknown as NewPrescription);
    return { status: "created", prescription, sentToServer: (prescription as unknown as { synced?: boolean }).synced === true };
  },

  /** Corrects a prescription that no order uses (one that is used is a record: it says so and nothing changes). The customer cannot be changed. */
  async edit(id: string, form: PrescriptionForm): Promise<SavePrescriptionResult> {
    const existing = await prescriptionTable.get(id);
    if (!existing) throw new LocalDbError(`Edit prescription: no prescription "${id}".`, "not-found");
    const checked = validatePrescriptionForm({ ...form, customerId: existing.customerId });
    if (checked.errors) return { status: "invalid", errors: checked.errors };
    const { customerId: _fixed, ...changes } = checked.prescription;
    const prescription = await prescriptionTable.update(id, changes as unknown as Partial<NewPrescription>);
    return { status: "updated", prescription, sentToServer: (prescription as unknown as { synced?: boolean }).synced === true };
  },
};

const lensTable = createLocalTableService<Lens, NewLens>({
  table: "lenses",
  label: "lens",
  delegate: "lens",
  orderBy: { name: "asc" },
  // Deletable, but never while an order line uses it (order_items.lens_id is RESTRICT here and on the server).
  syncedDelete: {
    kind: "lens",
    usedBy: (id, tenantKey) => sqlitePrisma.orderItem.count({ where: { lensId: id, tenantKey } }),
    usedMessage: (row, count) => `“${String(row.name)}” is used by ${count} order ${count === 1 ? "line" : "lines"}, so it cannot be deleted.`,
    name: (row) => String(row.name),
  },
});

/** A lens with the number of order lines that use it (a lens an order line uses cannot be deleted, but it can be retired). */
export type LensEntry = Lens & { usedByOrderLines: number };

/** What `create` / `edit` answer: the form's mistakes (nothing was saved), or the saved lens and whether the server has it. */
export type SaveLensResult =
  | { status: "invalid"; errors: FieldErrors }
  | { status: "created" | "updated"; lens: Lens; sentToServer: boolean };

const sent = (row: unknown) => (row as { synced?: boolean }).synced === true;

export const localLensService = {
  ...lensTable,

  /** Every lens by name (retired ones too), each with how many order lines use it. */
  async listWithUsage(): Promise<LensEntry[]> {
    const tenantKey = await currentTenantKey();
    const [lenses, counts] = await Promise.all([
      lensTable.list(),
      sqlitePrisma.orderItem.groupBy({ by: ["lensId"], where: { tenantKey, lensId: { not: null } }, _count: { _all: true } }),
    ]);
    const used = new Map(counts.map((c) => [c.lensId as string, c._count._all]));
    return lenses.map((lens) => ({ ...lens, usedByOrderLines: used.get(lens.id) ?? 0 }));
  },

  /** Saves a new lens: validated first, then saved and sent like any other row. */
  async create(form: LensForm): Promise<SaveLensResult> {
    const checked = validateLensForm(form);
    if (checked.errors) return { status: "invalid", errors: checked.errors };
    const lens = await lensTable.insert(checked.lens as unknown as NewLens);
    return { status: "created", lens, sentToServer: sent(lens) };
  },

  /** Changes a lens. The price on an order line is its own copy, so editing the lens never changes an order that was made. */
  async edit(id: string, form: LensForm): Promise<SaveLensResult> {
    if (!(await lensTable.get(id))) throw new LocalDbError(`Edit lens: no lens "${id}".`, "not-found");
    const checked = validateLensForm(form);
    if (checked.errors) return { status: "invalid", errors: checked.errors };
    const lens = await lensTable.update(id, checked.lens as unknown as Partial<NewLens>);
    return { status: "updated", lens, sentToServer: sent(lens) };
  },

  /** Retires a lens (it is no longer offered, and nothing is lost) or brings it back. */
  async setActive(id: string, isActive: boolean): Promise<Lens> {
    if (typeof isActive !== "boolean") throw new LocalDbError("Set active: give true or false.", "invalid-input");
    if (!(await lensTable.get(id))) throw new LocalDbError(`Set active: no lens "${id}".`, "not-found");
    return lensTable.update(id, { isActive });
  },
};

export const localOrderService = createLocalTableService<Order, NewOrder>({
  table: "orders",
  neverDeleted: true,
  label: "order",
  delegate: "order",
  dateFields: ["orderedAt", "promisedAt", "deliveredAt"],
  parents: parentsOf("orders"),
  orderBy: { orderedAt: "desc" },
});

export const localOrderItemService = createLocalTableService<OrderItem, NewOrderItem>({
  table: "order_items",
  neverDeleted: true,
  label: "order item",
  delegate: "orderItem",
  parents: parentsOf("order_items"),
  orderBy: { createdAt: "asc" },
});

export const localPaymentService = createLocalTableService<Payment, NewPayment>({
  table: "payments",
  neverDeleted: true,
  label: "payment",
  delegate: "payment",
  dateFields: ["paidAt", "chequeDueDate"],
  parents: parentsOf("payments"),
  orderBy: { paidAt: "desc" },
});

export const localInvoiceService = createLocalTableService<Invoice, NewInvoice>({
  table: "invoices",
  neverDeleted: true,
  label: "invoice",
  delegate: "invoice",
  dateFields: ["issuedAt"],
  parents: parentsOf("invoices"),
  orderBy: { issuedAt: "desc" },
});

export const localInvoiceItemService = createLocalTableService<InvoiceItem, NewInvoiceItem>({
  table: "invoice_items",
  neverDeleted: true,
  label: "invoice line",
  delegate: "invoiceItem",
  parents: parentsOf("invoice_items"),
  orderBy: { createdAt: "asc" },
});

// ---- Document numbers ---------------------------------------------------------------------------

const sequenceService = createLocalTableService<NumberSequence, never>({
  table: "number_sequences",
  label: "number sequence",
  delegate: "numberSequence",
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
