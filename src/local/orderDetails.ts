import { sqlitePrisma } from "../lib/sqliteClient";
import { currentTenantKey } from "./context";
import { LocalDbError } from "./errors";
import { ORDER_STATUSES } from "./salesService";
import { localOrderService, localPaymentService } from "./shopServices";

/**
 * The page of one order: who it is for, what is in it, what was paid and what is left, the payments one by one, its status. Also the two things
 * that can be done there: switch the status, and take a payment while something is left to pay. Real data only.
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
    paidCents,
    remainingCents,
    overdue: order.promisedAt !== null && order.promisedAt < today && OPEN.includes(order.status),
    items: items.map((i) => ({ id: i.id, kind: i.kind, description: i.description, eye: i.eye, quantity: i.quantity, unitPriceCents: i.unitPriceCents, totalCents: i.totalCents })),
    payments: payments.map((p) => ({ id: p.id, paidAt: p.paidAt.toISOString(), amountCents: p.amountCents, chequeDueDate: p.chequeDueDate?.toISOString() ?? null, notes: p.notes })),
    canPay: remainingCents > 0,
  };
}

export const localOrderDetailsService = {
  /** One order with its customer, lines and payments. A not-found error when it is not this shop's. */
  async get(id: string): Promise<OrderDetails> {
    if (typeof id !== "string" || !id) throw new LocalDbError("Order details: give the order's id.", "invalid-input");
    return loadDetails(id);
  },

  /**
   * Switches the order to another status (any of the five, so a slip can be undone). Delivered stamps the delivery day; leaving delivered clears it.
   * The change goes to the server like any other (or waits for the next sync).
   */
  async setStatus(id: string, status: string): Promise<OrderDetails> {
    if (!(ORDER_STATUSES as readonly string[]).includes(status)) throw new LocalDbError(`Set status: status must be one of ${ORDER_STATUSES.join(", ")}.`, "invalid-input");
    const before = await loadDetails(id);
    if (before.status !== status) await localOrderService.update(id, { status, deliveredAt: status === "delivered" ? new Date().toISOString() : null });
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
