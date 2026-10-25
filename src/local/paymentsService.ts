import { sqlitePrisma } from "../lib/sqliteClient";
import { currentTenantKey } from "./context";
import { LocalDbError } from "./errors";
import { periodFrom } from "./salesService";

/**
 * The Payments page: every payment taken by the shop, newest first, with who paid, for which order and how. Read-only. Real data only.
 *
 * Only what really entered the shop: cash, card, transfer, and cheques dated today or before. A cheque dated after today is money still to come,
 * not a payment yet, so it is left out of the list, the counts and the totals. The totals are over the payments the filters keep.
 */

export const PAYMENTS_LIMIT_DEFAULT = 100;
export const PAYMENTS_LIMIT_MAX = 500;

export interface PaymentRow {
  id: string;
  paidAt: string;
  amountCents: number;
  customerId: string | null;
  customerName: string | null;
  orderId: string | null;
  orderNumber: string | null;
  /** For a cheque: the day it can be cashed. */
  chequeDueDate: string | null;
  notes: string | null;
}

export interface PaymentsList {
  rows: PaymentRow[];
  /** Over the payments the period and the search match: how many and how much came in. */
  totals: { payments: number; collectedCents: number };
  matching: number;
  shown: number;
  /** The years that have at least one payment (newest first), for the year choice. */
  years: number[];
}

const startOfTomorrow = (): Date => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
};

export const localPaymentsService = {
  /**
   * filter.query: words typed in the search box; every word must match the customer's
   * name or the order's number. filter.year/month/day: the day, month or year the payment was taken. filter.limit: at most this many rows.
   */
  async list(filter: { query?: string; limit?: number; year?: number; month?: number; day?: number } = {}): Promise<PaymentsList> {
    const limit = typeof filter?.limit === "number" && Number.isInteger(filter.limit) && filter.limit > 0 ? Math.min(filter.limit, PAYMENTS_LIMIT_MAX) : PAYMENTS_LIMIT_DEFAULT;
    const words = (typeof filter?.query === "string" ? filter.query.trim().split(/\s+/).filter(Boolean) : []).slice(0, 6);
    const period = periodFrom(filter);

    const tenantKey = await currentTenantKey();
    const and: object[] = [];
    // (the customers are matched in the query itself: a list of their ids passed along would break past about a thousand customers with the same word in their name)
    for (const word of words) {
      const named = { customer: { is: { tenantKey, name: { contains: word } } } };
      and.push({ OR: [named, { order: { is: { tenantKey, OR: [{ number: { contains: word } }, named] } } }] });
    }
    const payments = await sqlitePrisma.payment.findMany({
      where: { tenantKey, OR: [{ chequeDueDate: null }, { chequeDueDate: { lt: startOfTomorrow() } }], ...(period ? { paidAt: period } : {}), ...(and.length ? { AND: and } : {}) },
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
      select: { id: true, paidAt: true, amountCents: true, customerId: true, orderId: true, chequeDueDate: true, notes: true },
    });

    const kept = payments;
    const totals = { payments: kept.length, collectedCents: kept.reduce((sum, p) => sum + p.amountCents, 0) };

    const page = kept.slice(0, limit);
    const orderIds = [...new Set(page.map((p) => p.orderId).filter((id): id is string => !!id))];
    const orders = orderIds.length ? await sqlitePrisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, number: true, customerId: true } }) : [];
    const orderById = new Map(orders.map((o) => [o.id, o]));
    // Who paid: the payment's own customer, else the customer of its order.
    const customerOf = (p: { customerId: string | null; orderId: string | null }) => p.customerId ?? (p.orderId ? orderById.get(p.orderId)?.customerId ?? null : null);
    const customerIds = [...new Set(page.map(customerOf).filter((id): id is string => !!id))];
    const names = new Map((customerIds.length ? await sqlitePrisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } }) : []).map((c) => [c.id, c.name]));
    const rows: PaymentRow[] = page.map((p) => {
      const customerId = customerOf(p);
      return {
        id: p.id,
        paidAt: p.paidAt.toISOString(),
        amountCents: p.amountCents,
        customerId,
        customerName: (customerId && names.get(customerId)) || null,
        orderId: p.orderId,
        orderNumber: (p.orderId && orderById.get(p.orderId)?.number) || null,
        chequeDueDate: p.chequeDueDate?.toISOString() ?? null,
        notes: p.notes,
      };
    });

    const dates = await sqlitePrisma.payment.findMany({ where: { tenantKey, OR: [{ chequeDueDate: null }, { chequeDueDate: { lt: startOfTomorrow() } }] }, select: { paidAt: true } });
    const years = [...new Set(dates.map((d) => d.paidAt.getFullYear()))].sort((a, b) => b - a);
    return { rows, totals, matching: payments.length, shown: rows.length, years };
  },
};
