import { sqlitePrisma } from "../lib/sqliteClient";
import { currentTenantKey } from "./context";
import { LocalDbError } from "./errors";

/**
 * The Sales page: every order of the shop, newest first, with its customer, its status and its money. Read-only. Real data only.
 *
 * Money rules (the same as the dashboard's): an order owes its total minus what was paid on it, never below 0; a cancelled order owes nothing and is
 * left out of the totals. The totals are over the orders the search matches and the status filter keeps.
 *
 * NET PROFIT of those orders = what the customers pay (the final price of each order) minus what the items COST the shop on the day of the sale (the cost saved on
 * each order line when the order was placed, never today's cost). It is counted only for the orders whose every line has a known cost: an order with a line
 * whose cost was not known has an unknown profit, and is counted apart (withoutCostOrders) instead of being passed off as pure profit.
 *
 * A second figure, over the very same orders: the PROFIT COLLECTED = what the customers have really paid on them (their payments) minus what they cost. It is
 * negative while the payments have not yet covered the costs (a deposit alone usually does not) and reaches the net profit when the orders are paid up.
 */

export const ORDER_STATUSES = ["confirmed", "at_lab", "ready", "delivered", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
const OPEN: readonly string[] = ["confirmed", "at_lab", "ready"]; // not yet delivered, not cancelled

export const SALES_LIMIT_DEFAULT = 100;
export const SALES_LIMIT_MAX = 500;
const WALK_IN = "Walk-in customer";

export interface SaleRow {
  id: string;
  number: string;
  status: string;
  customerId: string | null;
  customerName: string;
  orderedAt: string;
  promisedAt: string | null;
  deliveredAt: string | null;
  totalCents: number;
  paidCents: number;
  /** What is left to pay (0 for a cancelled order). */
  remainingCents: number;
  /** Promised for a day that has passed and still not handed over. */
  overdue: boolean;
}

export interface SalesList {
  rows: SaleRow[];
  /** How many orders each status has among the orders the search matches (so the filter chips can show them), and in all. */
  counts: Record<OrderStatus | "all", number>;
  /** Over the orders shown by the status filter (cancelled ones left out): how many, what they are worth, what was paid, what is left to pay. */
  totals: {
    orders: number;
    valueCents: number;
    paidCents: number;
    remainingCents: number;
    /** Net profit over the orders whose cost is known (profitOrders of them). */
    profitCents: number;
    /** The payments received on those same orders minus their costs (can be negative). */
    collectedProfitCents: number;
    profitOrders: number;
    /** Orders (not cancelled) left out of the profit because the cost of a line was not known. */
    withoutCostOrders: number;
  };
  /** How many orders the filter matches, and how many of them are in `rows` (the list is cut at the limit). */
  matching: number;
  shown: number;
  /** The years that have at least one order (newest first), for the year choice. */
  years: number[];
}

/** The day, month or year asked for (a month needs a year, a day needs a month), as a range of dates in the shop's local time; null for no period. */
export function periodFrom(filter: { year?: number; month?: number; day?: number } | undefined): { gte: Date; lt: Date } | null {
  const { year, month, day } = filter ?? {};
  const isInt = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
  if (year != null && !isInt(year, 1970, 9999)) throw new LocalDbError("list: year must be a whole year.", "invalid-input");
  if (month != null && (year == null || !isInt(month, 1, 12))) throw new LocalDbError("list: month must be 1 to 12 and needs a year.", "invalid-input");
  if (day != null && (month == null || !isInt(day, 1, 31))) throw new LocalDbError("list: day must be 1 to 31 and needs a month.", "invalid-input");
  if (year == null) return null;
  const from = new Date(year, month != null ? month - 1 : 0, day ?? 1);
  const to = day != null ? new Date(year, month! - 1, day + 1) : month != null ? new Date(year, month, 1) : new Date(year + 1, 0, 1);
  return { gte: from, lt: to };
}

/**
 * What each order's lines cost, from the cost saved on every line: order id -> the sum, or null when any line has no known cost. An order with no lines is not
 * in the map (its profit is unknown). Asked in chunks, so a long list of orders never exceeds the database's limit on parameters.
 */
async function costsOf(tenantKey: string, orderIds: string[]): Promise<Map<string, number | null>> {
  const costs = new Map<string, number | null>();
  for (let i = 0; i < orderIds.length; i += 400) {
    const items = await sqlitePrisma.orderItem.findMany({ where: { tenantKey, orderId: { in: orderIds.slice(i, i + 400) } }, select: { orderId: true, quantity: true, unitCostCents: true } });
    for (const item of items) {
      const so_far = costs.get(item.orderId);
      if (so_far === null) continue; // already unknown
      costs.set(item.orderId, item.unitCostCents === null ? null : (so_far ?? 0) + item.unitCostCents * item.quantity);
    }
  }
  return costs;
}

const startOfToday = (): Date => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
};

export const localSalesService = {
  /**
   * filter.status: one of the statuses, or "all"/nothing. filter.query: words typed in the search box; every word must match the order's number or its
   * customer's name. filter.limit: at most this many rows (default 100, at most 500).
   */
  async list(filter: { status?: string; query?: string; limit?: number; year?: number; month?: number; day?: number } = {}): Promise<SalesList> {
    const status = filter?.status ?? "all";
    if (status !== "all" && !(ORDER_STATUSES as readonly string[]).includes(status)) throw new LocalDbError(`list: status must be one of ${ORDER_STATUSES.join(", ")} or "all".`, "invalid-input");
    const limit = typeof filter?.limit === "number" && Number.isInteger(filter.limit) && filter.limit > 0 ? Math.min(filter.limit, SALES_LIMIT_MAX) : SALES_LIMIT_DEFAULT;
    const words = (typeof filter?.query === "string" ? filter.query.trim().split(/\s+/).filter(Boolean) : []).slice(0, 6);

    const period = periodFrom(filter);

    const tenantKey = await currentTenantKey();
    const and: object[] = [];
    for (const word of words) {
      const customers = await sqlitePrisma.customer.findMany({ where: { tenantKey, name: { contains: word } }, select: { id: true } });
      and.push({ OR: [{ number: { contains: word } }, { customerId: { in: customers.map((c) => c.id) } }] });
    }
    const [orders, payments] = await Promise.all([
      sqlitePrisma.order.findMany({
        where: { tenantKey, ...(period ? { orderedAt: period } : {}), ...(and.length ? { AND: and } : {}) },
        orderBy: [{ orderedAt: "desc" }, { number: "desc" }],
        select: { id: true, number: true, status: true, customerId: true, orderedAt: true, promisedAt: true, deliveredAt: true, totalCents: true },
      }),
      sqlitePrisma.payment.groupBy({ by: ["orderId"], where: { tenantKey, orderId: { not: null } }, _sum: { amountCents: true } }),
    ]);
    const paid = new Map(payments.map((p) => [p.orderId as string, p._sum.amountCents ?? 0]));

    const counts = { all: orders.length, confirmed: 0, at_lab: 0, ready: 0, delivered: 0, cancelled: 0 } as SalesList["counts"];
    for (const o of orders) if ((ORDER_STATUSES as readonly string[]).includes(o.status)) counts[o.status as OrderStatus]++;

    const kept = status === "all" ? orders : orders.filter((o) => o.status === status);
    const totals = { orders: 0, valueCents: 0, paidCents: 0, remainingCents: 0, profitCents: 0, collectedProfitCents: 0, profitOrders: 0, withoutCostOrders: 0 };
    const counted = kept.filter((o) => o.status !== "cancelled");
    const costOf = await costsOf(tenantKey, counted.map((o) => o.id));
    for (const o of counted) {
      const p = paid.get(o.id) ?? 0;
      totals.orders++;
      totals.valueCents += o.totalCents;
      totals.paidCents += p;
      totals.remainingCents += Math.max(0, o.totalCents - p);
      const cost = costOf.get(o.id);
      if (cost === undefined || cost === null) totals.withoutCostOrders++;
      else {
        totals.profitCents += o.totalCents - cost;
        totals.collectedProfitCents += p - cost;
        totals.profitOrders++;
      }
    }

    const page = kept.slice(0, limit);
    const ids = [...new Set(page.map((o) => o.customerId).filter((id): id is string => !!id))];
    const names = new Map((ids.length ? await sqlitePrisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []).map((c) => [c.id, c.name]));
    const today = startOfToday();
    const rows: SaleRow[] = page.map((o) => {
      const p = paid.get(o.id) ?? 0;
      return {
        id: o.id,
        number: o.number,
        status: o.status,
        customerId: o.customerId,
        customerName: (o.customerId && names.get(o.customerId)) || WALK_IN,
        orderedAt: o.orderedAt.toISOString(),
        promisedAt: o.promisedAt?.toISOString() ?? null,
        deliveredAt: o.deliveredAt?.toISOString() ?? null,
        totalCents: o.totalCents,
        paidCents: p,
        remainingCents: o.status === "cancelled" ? 0 : Math.max(0, o.totalCents - p),
        overdue: o.promisedAt !== null && o.promisedAt < today && OPEN.includes(o.status),
      };
    });
    const dates = await sqlitePrisma.order.findMany({ where: { tenantKey }, select: { orderedAt: true } });
    const years = [...new Set(dates.map((d) => d.orderedAt.getFullYear()))].sort((a, b) => b - a);
    return { rows, counts, totals, matching: kept.length, shown: rows.length, years };
  },
};
