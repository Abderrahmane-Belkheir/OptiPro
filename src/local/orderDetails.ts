import { sqlitePrisma } from "../lib/sqliteClient";
import { currentTenantKey } from "./context";
import { LocalDbError } from "./errors";
import { ORDER_STATUSES } from "./salesService";
import { localOrderService, localPaymentService } from "./shopServices";
import { pushRow } from "./syncPush";

/**
 * The page of one order: who it is for, what is in it, what was paid and what is left, the payments one by one, its status. Also the two things
 * that can be done there: switch the status, take a payment while something is left to pay, and correct the prices and costs (edit). Real data only.
 *
 * Money rules (the same as the Orders list): an order owes its total minus what was paid on it, never below 0; a cancelled order owes nothing.
 */

export interface OrderLine {
  id: string;
  kind: string;
  description: string;
  eye: string | null;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  /** What ONE cost the shop on the day of the sale; null = not known. */
  unitCostCents: number | null;
}

export interface OrderPayment {
  id: string;
  paidAt: string;
  amountCents: number;
  /** For a payment by post-dated cheque: the day it can be cashed. */
  chequeDueDate: string | null;
  /** The note typed when the payment was taken. */
  notes: string | null;
}

export interface OrderDetails {
  id: string;
  number: string;
  status: string;
  customer: { id: string; name: string; phone: string | null } | null;
  orderedAt: string;
  promisedAt: string | null;
  deliveredAt: string | null;
  notes: string | null;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  /** What the lines cost in all, and what the order earns (its final price minus that cost); null when the cost of a line is not known. */
  costCents: number | null;
  profitCents: number | null;
  paidCents: number;
  /** What is left to pay (0 for a cancelled order). */
  remainingCents: number;
  /** Promised for a day that has passed and still not handed over. */
  overdue: boolean;
  items: OrderLine[];
  payments: OrderPayment[];
  /** Whether a payment can be taken now: something is left to pay and the order is not cancelled. */
  canPay: boolean;
}

const OPEN = ["confirmed", "at_lab", "ready"];

async function loadDetails(id: string): Promise<OrderDetails> {
  const tenantKey = await currentTenantKey();
  const order = await sqlitePrisma.order.findFirst({ where: { id, tenantKey } });
  if (!order) throw new LocalDbError(`Order "${id}" does not exist.`, "not-found");
  const [customer, items, payments] = await Promise.all([
    order.customerId ? sqlitePrisma.customer.findFirst({ where: { id: order.customerId, tenantKey }, select: { id: true, name: true, phone: true } }) : null,
    sqlitePrisma.orderItem.findMany({ where: { orderId: id, tenantKey }, orderBy: { createdAt: "asc" } }),
    sqlitePrisma.payment.findMany({ where: { orderId: id, tenantKey }, orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }] }),
  ]);
  const paidCents = payments.reduce((sum, p) => sum + p.amountCents, 0);
  const cancelled = order.status === "cancelled";
  const remainingCents = cancelled ? 0 : Math.max(0, order.totalCents - paidCents);
  const n = new Date();
  const today = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    customer,
    orderedAt: order.orderedAt.toISOString(),
    promisedAt: order.promisedAt?.toISOString() ?? null,
    deliveredAt: order.deliveredAt?.toISOString() ?? null,
    notes: order.notes,
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    totalCents: order.totalCents,
    costCents: items.length > 0 && items.every((i) => i.unitCostCents !== null) ? items.reduce((sum, i) => sum + i.unitCostCents! * i.quantity, 0) : null,
    profitCents: items.length > 0 && items.every((i) => i.unitCostCents !== null) ? order.totalCents - items.reduce((sum, i) => sum + i.unitCostCents! * i.quantity, 0) : null,
    paidCents,
    remainingCents,
    overdue: order.promisedAt !== null && order.promisedAt < today && OPEN.includes(order.status),
    items: items.map((i) => ({ id: i.id, kind: i.kind, description: i.description, eye: i.eye, quantity: i.quantity, unitPriceCents: i.unitPriceCents, totalCents: i.totalCents, unitCostCents: i.unitCostCents })),
    payments: payments.map((p) => ({ id: p.id, paidAt: p.paidAt.toISOString(), amountCents: p.amountCents, chequeDueDate: p.chequeDueDate?.toISOString() ?? null, notes: p.notes })),
    canPay: remainingCents > 0,
  };
}

/**
 * Puts the order's frames and accessories back in the stock (direction +1) or takes them out again (-1), by the quantity on each line. The stock never goes below 0
 * (a count that was wrong must not block the change). The frames are marked unsent and sent, so the server gets the new stock.
 */
async function moveFrameStock(orderId: string, direction: 1 | -1): Promise<void> {
  const tenantKey = await currentTenantKey();
  const lines = await sqlitePrisma.orderItem.findMany({
    where: { orderId, tenantKey, OR: [{ kind: "frame", frameId: { not: null } }, { kind: "accessory", accessoryId: { not: null } }] },
    select: { kind: true, frameId: true, accessoryId: true, quantity: true },
  });
  if (lines.length === 0) return;
  await sqlitePrisma.$transaction(async (tx) => {
    for (const line of lines) {
      const frame = line.kind === "frame";
      const id = (frame ? line.frameId : line.accessoryId)!;
      if (direction === 1) {
        const data = { stock: { increment: line.quantity }, synced: false };
        if (frame) await tx.frame.updateMany({ where: { id, tenantKey }, data });
        else await tx.accessory.updateMany({ where: { id, tenantKey }, data });
      } else {
        const product = frame ? await tx.frame.findFirst({ where: { id, tenantKey }, select: { stock: true } }) : await tx.accessory.findFirst({ where: { id, tenantKey }, select: { stock: true } });
        if (!product) continue;
        const data = { stock: Math.max(0, product.stock - line.quantity), synced: false };
        if (frame) await tx.frame.updateMany({ where: { id, tenantKey }, data });
        else await tx.accessory.updateMany({ where: { id, tenantKey }, data });
      }
    }
  });
  for (const line of lines) {
    const frame = line.kind === "frame";
    const id = (frame ? line.frameId : line.accessoryId)!;
    await pushRow(frame ? "frames" : "accessories", id);
    // (a product that reached 0 was given the supplier-order line waiting for it by the database: that line is sent too)
    for (const item of await sqlitePrisma.supplierOrderItem.findMany({ where: { [frame ? "frameId" : "accessoryId"]: id, tenantKey, used: true, synced: false }, select: { id: true } })) await pushRow("supplier_order_items", item.id);
  }
}

const isMoney = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100_000_000_00;

/**
 * The changes to an order (its status, its money, a payment) are made ONE AT A TIME. Each one reads the order, decides, then writes; two at once (a double click, a slow answer
 * and a second try) would both read the same state: the same last payment taken twice, an order cancelled twice with its frames put back in the stock twice.
 */
let changing: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(change: () => Promise<T>): Promise<T> {
  const run = changing.then(change);
  changing = run.then(() => undefined, () => undefined);
  return run;
}

const orderDetails = {
  /** One order with its customer, lines and payments. A not-found error when it is not this shop's. */
  async get(id: string): Promise<OrderDetails> {
    if (typeof id !== "string" || !id) throw new LocalDbError("Order details: give the order's id.", "invalid-input");
    return loadDetails(id);
  },

  /**
   * Switches the order to another status (any of the five, so a slip can be undone). Delivered stamps the delivery day; leaving delivered clears it.
   * The change goes to the server like any other (or waits for the next sync).
   * Cancelling an order puts its frames and accessories back in the stock (placing the order took them out); taking the order out of "cancelled" takes them out again.
   */
  async setStatus(id: string, status: string): Promise<OrderDetails> {
    if (!(ORDER_STATUSES as readonly string[]).includes(status)) throw new LocalDbError(`Set status: status must be one of ${ORDER_STATUSES.join(", ")}.`, "invalid-input");
    const before = await loadDetails(id);
    if (before.status !== status) {
      await localOrderService.update(id, { status, deliveredAt: status === "delivered" ? new Date().toISOString() : null });
      if (status === "cancelled") await moveFrameStock(id, +1);
      else if (before.status === "cancelled") await moveFrameStock(id, -1);
    }
    return loadDetails(id);
  },

  /**
   * Corrects the money of an order. input.lines: for the lines to change, { id, unitPriceCents?, unitCostCents? }: the price of ONE piece (only a lens line has its price changed
   * here, the others come from the catalogue) and what ONE cost (any line; null = not known). input.finalPriceCents: what the customer pays for the whole order.
   * The items' total is worked out again from the prices; unless a final price is given, the discount stays what it was (never more than the items add up to). The final
   * price cannot be more than the items add up to (to charge more, raise the price of the lens), nor less than what was already paid. The invoice already issued for
   * the order, if there is one, is corrected the same way (it keeps its number). Everything is sent to the server like any other change.
   */
  async edit(id: string, input: { finalPriceCents?: number | null; lines?: { id: string; unitPriceCents?: number; unitCostCents?: number | null }[] }): Promise<OrderDetails> {
    const before = await loadDetails(id);
    const tenantKey = await currentTenantKey();
    const changes = Array.isArray(input?.lines) ? input.lines : [];
    const byId = new Map(before.items.map((i) => [i.id, i]));
    const newLines = new Map<string, { unitPriceCents: number; unitCostCents: number | null }>();
    for (const c of changes) {
      const line = byId.get(c?.id);
      if (!line) throw new LocalDbError("Edit: a line to change is not on this order.", "invalid-input");
      if (c.unitPriceCents !== undefined) {
        if (line.kind !== "lens") throw new LocalDbError("Edit: only the price of a lens can be changed here.", "invalid-input");
        if (!isMoney(c.unitPriceCents)) throw new LocalDbError("Edit: the price of a lens must be an amount of 0 or more.", "invalid-input");
      }
      if (c.unitCostCents !== undefined && c.unitCostCents !== null && !isMoney(c.unitCostCents)) throw new LocalDbError("Edit: a cost must be an amount of 0 or more, or empty when it is not known.", "invalid-input");
      newLines.set(line.id, { unitPriceCents: c.unitPriceCents ?? line.unitPriceCents, unitCostCents: c.unitCostCents === undefined ? line.unitCostCents : c.unitCostCents });
    }
    const priced = before.items.map((i) => ({ ...i, ...(newLines.get(i.id) ?? {}) }));
    const subtotalCents = priced.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
    let totalCents: number;
    if (input?.finalPriceCents !== undefined && input.finalPriceCents !== null) {
      if (!isMoney(input.finalPriceCents)) throw new LocalDbError("Edit: the final price must be an amount of 0 or more.", "invalid-input");
      if (input.finalPriceCents > subtotalCents) throw new LocalDbError(`Edit: the final price cannot be more than the items add up to (${subtotalCents / 100}). To charge more, change the price of the lens.`, "invalid-input");
      totalCents = input.finalPriceCents;
    } else totalCents = subtotalCents - Math.min(before.discountCents, subtotalCents);
    if (totalCents < before.paidCents) throw new LocalDbError(`Edit: the final price cannot be less than what was already paid (${before.paidCents / 100}).`, "invalid-input");

    const changedLines = before.items.filter((i) => {
      const n = newLines.get(i.id);
      return n && (n.unitPriceCents !== i.unitPriceCents || n.unitCostCents !== i.unitCostCents);
    });
    if (changedLines.length === 0 && totalCents === before.totalCents && subtotalCents === before.subtotalCents) return before;

    const discountCents = subtotalCents - totalCents;
    const invoice = await sqlitePrisma.invoice.findFirst({ where: { orderId: id, tenantKey, kind: "invoice" }, orderBy: { createdAt: "asc" }, select: { id: true } });
    const invoiceItems = invoice ? await sqlitePrisma.invoiceItem.findMany({ where: { invoiceId: invoice.id, tenantKey }, orderBy: { createdAt: "asc" } }) : [];
    const invoiceLinesChanged: string[] = [];
    await sqlitePrisma.$transaction(async (tx) => {
      for (const line of changedLines) {
        const n = newLines.get(line.id)!;
        await tx.orderItem.updateMany({ where: { id: line.id, tenantKey }, data: { unitPriceCents: n.unitPriceCents, totalCents: n.unitPriceCents * line.quantity, unitCostCents: n.unitCostCents, synced: false } });
        if (n.unitPriceCents !== line.unitPriceCents) {
          // the same line on the invoice already issued (found by what it said)
          const copy = invoiceItems.find((c) => !invoiceLinesChanged.includes(c.id) && c.description === line.description && c.unitPriceCents === line.unitPriceCents && c.quantity === line.quantity);
          if (copy) {
            invoiceLinesChanged.push(copy.id);
            await tx.invoiceItem.updateMany({ where: { id: copy.id, tenantKey }, data: { unitPriceCents: n.unitPriceCents, totalCents: n.unitPriceCents * line.quantity, synced: false } });
          }
        }
      }
      await tx.order.updateMany({ where: { id, tenantKey }, data: { subtotalCents, discountCents, totalCents, synced: false } });
      if (invoice) await tx.invoice.updateMany({ where: { id: invoice.id, tenantKey }, data: { subtotalCents, discountCents, totalCents, synced: false } });
    });
    await pushRow("orders", id);
    for (const line of changedLines) await pushRow("order_items", line.id);
    if (invoice) {
      await pushRow("invoices", invoice.id);
      for (const lineId of invoiceLinesChanged) await pushRow("invoice_items", lineId);
    }
    return loadDetails(id);
  },

  /**
   * Takes a payment on the order. The amount (in centimes, a whole number) must be more than 0 and no more than what is left to pay; a cancelled
   * order takes none. The payment is dated now and goes to the server like any other (or waits for the next sync).
   */
  async pay(id: string, input: { amountCents: number; notes?: string | null }): Promise<OrderDetails> {
    const amount = input?.amountCents;
    if (!Number.isInteger(amount) || amount <= 0) throw new LocalDbError("Pay: the amount must be a whole number of centimes above 0.", "invalid-input");
    const notes = typeof input?.notes === "string" && input.notes.trim() ? input.notes.trim().slice(0, 500) : null;
    const before = await loadDetails(id);
    if (before.status === "cancelled") throw new LocalDbError("Pay: this order is cancelled, it takes no payment.", "invalid-input");
    if (before.remainingCents <= 0) throw new LocalDbError("Pay: nothing is left to pay on this order.", "invalid-input");
    if (amount > before.remainingCents) throw new LocalDbError(`Pay: the amount is more than what is left to pay (${before.remainingCents} centimes).`, "invalid-input");
    await localPaymentService.insert({ orderId: id, customerId: before.customer?.id ?? null, amountCents: amount, paidAt: new Date().toISOString(), notes });
    return loadDetails(id);
  },
};

export const localOrderDetailsService = {
  get: orderDetails.get,
  setStatus: (id: string, status: string) => oneAtATime(() => orderDetails.setStatus(id, status)),
  edit: (id: string, input: Parameters<typeof orderDetails.edit>[1]) => oneAtATime(() => orderDetails.edit(id, input)),
  pay: (id: string, input: Parameters<typeof orderDetails.pay>[1]) => oneAtATime(() => orderDetails.pay(id, input)),
};
