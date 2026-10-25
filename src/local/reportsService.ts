import { sqlitePrisma } from "../lib/sqliteClient";
import { currentTenantKey } from "./context";
import { ORDER_STATUSES, periodFrom, type OrderStatus } from "./salesService";

/**
 * What the Reports page shows (renderer/pages/reports.js). Read-only: nothing here writes. Every figure is for the current shop, in the shop computer's local
 * time, and money is in cents.
 *
 * The page looks at one PERIOD (a month, a year, or everything), and three kinds of figures:
 *  - SALES are the orders PLACED in the period (by their order date). A cancelled order is not a sale: it is only counted apart.
 *  - COLLECTED is the money received in the period (by the day it reached the shop). A cheque counts on the day it falls due, not the day it was recorded; one
 *    that is not due yet is not money in hand, and is shown apart (chequesLaterCents). Money received on a cancelled order stays money received.
 *  - NET PROFIT is the same as on the Orders page: what the customers pay (the order's final price, after its discount) minus what its lines cost on the day of
 *    the sale (the cost saved on each line). An order with a line whose cost was not known has an unknown profit and is counted apart (withoutCostOrders)
 *    instead of being passed off as pure profit.
 * A period is compared with the one before it (the month before, the year before); while the period is not over, with the same stretch of the one before
 * (the first 9 days of this month against the first 9 days of last month), so a month that has just begun is not shown as a collapse.
 *
 * The figures that are not about a period (who owes money today, what the stock is worth now) are their own calls: debtors() and inventory().
 */

const WALK_IN = "Walk-in customer";
const TOP = 10;
const KINDS = ["frame", "lens", "accessory", "service"] as const;
const dayKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monthKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const cents = (units: number): number => Math.round(units * 100);

type Range = { gte: Date; lt: Date };
export type Granularity = "day" | "month" | "year";

/** The headline figures of one period. */
export interface ReportHeadline {
  /** Orders placed (cancelled ones not counted), and the cancelled ones apart. */
  orders: number;
  cancelledOrders: number;
  /** What those orders are worth (their final prices), the discounts that were given on them, and the average order. */
  salesCents: number;
  discountCents: number;
  averageOrderCents: number;
  /** Net profit over the orders whose cost is known (profitOrders of them), and the cost of those orders; the share of their price that is profit, in percent (null when there is none). */
  profitCents: number;
  costCents: number;
  profitOrders: number;
  marginPercent: number | null;
  /** Orders (not cancelled) left out of the profit because the cost of a line was not known. */
  withoutCostOrders: number;
  /** Money received in the period. */
  collectedCents: number;
  /** Cheques recorded in the period that fall due after today: not money in hand yet. */
  chequesLaterCents: number;
  /** What the supplier orders of the period cost (the cancelled ones not counted), and how many they are. */
  purchasesCents: number;
  purchaseOrders: number;
  /** Customers added in the period. */
  newCustomers: number;
}

export interface ReportSeriesPoint {
  /** "2026-03-05" (a day), "2026-03" (a month) or "2026" (a year). */
  key: string;
  salesCents: number;
  collectedCents: number;
}

export interface ReportKindRow {
  kind: (typeof KINDS)[number];
  /** Pieces sold, and what the lines are worth (before the order's discount). */
  quantity: number;
  revenueCents: number;
  /** Over the lines whose cost is known: their price, their cost, and so their profit (null when no line has a known cost). Lines with no known cost are counted apart. */
  profitCents: number | null;
  unknownCostLines: number;
}

export interface ReportProductRow {
  kind: string;
  name: string;
  quantity: number;
  revenueCents: number;
  profitCents: number | null;
}

export interface ReportCustomerRow {
  customerId: string;
  customerName: string;
  orders: number;
  valueCents: number;
}

export interface ReportSupplierRow {
  supplierId: string;
  supplierName: string;
  orders: number;
  spentCents: number;
}

export interface ReportsOverview {
  granularity: Granularity;
  /** The period as asked (null = everything) and the range it covers (ISO dates). */
  year: number | null;
  month: number | null;
  /** The years that have at least one order (newest first), for the year choice. */
  years: number[];
  current: ReportHeadline;
  /** The period before it, null when there is none to compare with (the whole history). partial: only the same stretch of it was counted. */
  previous: ReportHeadline | null;
  previousPartial: boolean;
  series: ReportSeriesPoint[];
  byKind: ReportKindRow[];
  topProducts: ReportProductRow[];
  topCustomers: ReportCustomerRow[];
  /** How many orders each status holds among the orders placed in the period (the cancelled ones too). */
  statuses: Record<OrderStatus, number>;
  suppliers: ReportSupplierRow[];
}

export interface ReportDebtor {
  customerId: string | null;
  customerName: string;
  orders: number;
  owedCents: number;
  /** The oldest delivery among their unpaid orders. */
  since: string | null;
}

export interface ReportDebtors {
  /** Every order that is not cancelled and not fully paid, whatever its status (the customer's page adds up the same): what is left to pay, over how many orders and how many customers. */
  owedCents: number;
  orders: number;
  customers: number;
  rows: ReportDebtor[];
}

export interface ReportStock {
  /** Products in stock (stock above 0) and the pieces they make, what the pieces cost the shop and what they are priced at. */
  products: number;
  units: number;
  costValueCents: number;
  priceValueCents: number;
  /** Products in stock with no cost entered (their cost is not in costValueCents). */
  withoutCost: number;
  outOfStock: number;
}

export interface ReportInventory {
  frames: ReportStock;
  accessories: ReportStock;
  total: Omit<ReportStock, "outOfStock">;
}

/** The period before `range`: the month before a month, the year before a year; while `now` is inside `range`, only as much of it as has passed in `range`. */
function previousRange(year: number, month: number | null, range: Range, now: Date): { range: Range; partial: boolean } {
  const before = periodFrom(month != null ? (month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }) : { year: year - 1 })!;
  if (now >= range.gte && now < range.lt) {
    const to = new Date(Math.min(before.lt.getTime(), before.gte.getTime() + (now.getTime() - range.gte.getTime())));
    return { range: { gte: before.gte, lt: to }, partial: true };
  }
  return { range: before, partial: false };
}

/** The day a payment counts: a cheque falls due on its date (when that is after the day it was recorded), any other payment is money the day it was received. */
const effectiveDate = (p: { paidAt: Date; chequeDueDate: Date | null }): Date => (p.chequeDueDate && p.chequeDueDate > p.paidAt ? p.chequeDueDate : p.paidAt);
const inRange = (d: Date, range: Range | null): boolean => !range || (d >= range.gte && d < range.lt);

interface Loaded {
  orders: { id: string; status: string; customerId: string | null; orderedAt: Date; totalCents: number; discountCents: number }[];
  items: { orderId: string; kind: string; description: string; frameId: string | null; lensId: string | null; accessoryId: string | null; quantity: number; totalCents: number; unitCostCents: number | null }[];
  payments: { paidAt: Date; chequeDueDate: Date | null; amountCents: number }[];
  supplierOrders: { supplierId: string; orderedAt: Date; totalCents: number }[];
  newCustomers: number;
}

async function load(tenantKey: string, range: Range | null): Promise<Loaded> {
  const orderedAt = range ? { orderedAt: range } : {};
  const [orders, items, payments, supplierOrders, newCustomers] = await Promise.all([
    sqlitePrisma.order.findMany({ where: { tenantKey, ...orderedAt }, select: { id: true, status: true, customerId: true, orderedAt: true, totalCents: true, discountCents: true } }),
    sqlitePrisma.orderItem.findMany({
      where: { tenantKey, order: { is: { tenantKey, status: { not: "cancelled" }, ...orderedAt } } },
      select: { orderId: true, kind: true, description: true, frameId: true, lensId: true, accessoryId: true, quantity: true, totalCents: true, unitCostCents: true },
    }),
    sqlitePrisma.payment.findMany({
      where: { tenantKey, ...(range ? { OR: [{ paidAt: range }, { chequeDueDate: range }] } : {}) },
      select: { paidAt: true, chequeDueDate: true, amountCents: true },
    }),
    sqlitePrisma.supplierOrder.findMany({ where: { tenantKey, status: { not: "cancelled" }, ...orderedAt }, select: { supplierId: true, orderedAt: true, totalCents: true } }),
    sqlitePrisma.customer.count({ where: { tenantKey, ...(range ? { createdAt: range } : {}) } }),
  ]);
  return { orders, items, payments, supplierOrders, newCustomers };
}

/** What each order's lines cost: order id -> the sum, or null when any line has no known cost. An order with no lines is not in the map (its profit is unknown). */
function costsOf(items: Loaded["items"]): Map<string, number | null> {
  const costs = new Map<string, number | null>();
  for (const item of items) {
    const so_far = costs.get(item.orderId);
    if (so_far === null) continue;
    costs.set(item.orderId, item.unitCostCents === null ? null : (so_far ?? 0) + item.unitCostCents * item.quantity);
  }
  return costs;
}

function headlineOf(data: Loaded, range: Range | null, now: Date): ReportHeadline {
  const counted = data.orders.filter((o) => o.status !== "cancelled");
  const costOf = costsOf(data.items);
  const h: ReportHeadline = {
    orders: counted.length, cancelledOrders: data.orders.length - counted.length, salesCents: 0, discountCents: 0, averageOrderCents: 0,
    profitCents: 0, costCents: 0, profitOrders: 0, marginPercent: null, withoutCostOrders: 0, collectedCents: 0, chequesLaterCents: 0,
    purchasesCents: 0, purchaseOrders: data.supplierOrders.length, newCustomers: data.newCustomers,
  };
  let profitSales = 0;
  for (const o of counted) {
    h.salesCents += o.totalCents;
    h.discountCents += o.discountCents;
    const cost = costOf.get(o.id);
    if (cost === undefined || cost === null) h.withoutCostOrders++;
    else {
      h.profitCents += o.totalCents - cost;
      h.costCents += cost;
      profitSales += o.totalCents;
      h.profitOrders++;
    }
  }
  h.averageOrderCents = counted.length > 0 ? Math.round(h.salesCents / counted.length) : 0;
  h.marginPercent = h.profitOrders > 0 && profitSales > 0 ? Math.round((h.profitCents / profitSales) * 1000) / 10 : null;
  for (const p of data.payments) {
    const when = effectiveDate(p);
    if (when <= now) {
      if (inRange(when, range)) h.collectedCents += p.amountCents;
    } else if (inRange(p.paidAt, range)) h.chequesLaterCents += p.amountCents;
  }
  h.purchasesCents = data.supplierOrders.reduce((sum, s) => sum + s.totalCents, 0);
  return h;
}

/** The buckets of the chart: the days of a month, the months of a year, or the years from the first order to now. */
function bucketsOf(granularity: Granularity, year: number | null, month: number | null, firstYear: number, now: Date): { key: string; of: (d: Date) => string }[] {
  if (granularity === "day") {
    const days = new Date(year!, month!, 0).getDate();
    return Array.from({ length: days }, (_, i) => ({ key: dayKey(new Date(year!, month! - 1, i + 1)), of: dayKey }));
  }
  if (granularity === "month") return Array.from({ length: 12 }, (_, i) => ({ key: monthKey(new Date(year!, i, 1)), of: monthKey }));
  const last = Math.max(now.getFullYear(), firstYear);
  return Array.from({ length: last - firstYear + 1 }, (_, i) => ({ key: String(firstYear + i), of: (d: Date) => String(d.getFullYear()) }));
}

export const localReportsService = {
  /** The whole picture of one period: filter.year (and filter.month, which needs a year); nothing = everything. */
  async overview(filter: { year?: number; month?: number } = {}): Promise<ReportsOverview> {
    const tenantKey = await currentTenantKey();
    const range = periodFrom({ year: filter?.year, month: filter?.month });
    const year = filter?.year ?? null;
    const month = filter?.month ?? null;
    const granularity: Granularity = month != null ? "day" : year != null ? "month" : "year";
    const now = new Date();

    const before = range ? previousRange(year!, month, range, now) : null;
    const [data, beforeData, dates, customersList] = await Promise.all([
      load(tenantKey, range),
      before ? load(tenantKey, before.range) : Promise.resolve(null),
      sqlitePrisma.order.findMany({ where: { tenantKey }, select: { orderedAt: true } }),
      sqlitePrisma.customer.findMany({ where: { tenantKey }, select: { id: true, name: true } }),
    ]);
    const years = [...new Set(dates.map((d) => d.orderedAt.getFullYear()))].sort((a, b) => b - a);
    const current = headlineOf(data, range, now);
    const previous = before && beforeData ? headlineOf(beforeData, before.range, now) : null;

    // the chart: what was sold and what was received, in each day, month or year
    const firstYear = years.length > 0 ? years[years.length - 1] : now.getFullYear();
    const buckets = bucketsOf(granularity, year, month, firstYear, now);
    const series = new Map<string, ReportSeriesPoint>(buckets.map((b) => [b.key, { key: b.key, salesCents: 0, collectedCents: 0 }]));
    const bucketOf = buckets[0].of;
    for (const o of data.orders) if (o.status !== "cancelled") {
      const point = series.get(bucketOf(o.orderedAt));
      if (point) point.salesCents += o.totalCents;
    }
    for (const p of data.payments) {
      const when = effectiveDate(p);
      if (when > now || !inRange(when, range)) continue;
      const point = series.get(bucketOf(when));
      if (point) point.collectedCents += p.amountCents;
    }

    // what was sold, by kind of line and by product (a line is the price before the order's discount)
    const live = new Set(data.orders.filter((o) => o.status !== "cancelled").map((o) => o.id));
    const kinds = new Map<string, ReportKindRow & { knownRevenue: number; knownCost: number; known: number }>(
      KINDS.map((kind) => [kind, { kind, quantity: 0, revenueCents: 0, profitCents: null, unknownCostLines: 0, knownRevenue: 0, knownCost: 0, known: 0 }]),
    );
    const products = new Map<string, ReportProductRow & { knownRevenue: number; knownCost: number; known: number }>();
    for (const item of data.items) {
      if (!live.has(item.orderId)) continue;
      const row = kinds.get(item.kind) ?? kinds.get("service")!;
      const key = `${item.kind}:${item.frameId ?? item.lensId ?? item.accessoryId ?? item.description}`;
      const product = products.get(key) ?? { kind: item.kind, name: item.description, quantity: 0, revenueCents: 0, profitCents: null, knownRevenue: 0, knownCost: 0, known: 0 };
      products.set(key, product);
      for (const r of [row, product]) {
        r.quantity += item.quantity;
        r.revenueCents += item.totalCents;
        if (item.unitCostCents === null) {
          if ("unknownCostLines" in r) r.unknownCostLines++;
        } else {
          r.knownRevenue += item.totalCents;
          r.knownCost += item.unitCostCents * item.quantity;
          r.known++;
        }
      }
    }
    const withProfit = <T extends { profitCents: number | null; knownRevenue: number; knownCost: number; known: number }>({ knownRevenue, knownCost, known, ...rest }: T) => ({ ...rest, profitCents: known > 0 ? knownRevenue - knownCost : null });
    const byKind = [...kinds.values()].map(withProfit).filter((r) => r.quantity > 0 || r.revenueCents > 0) as ReportKindRow[];
    const topProducts = [...products.values()].map(withProfit).sort((a, b) => b.revenueCents - a.revenueCents || b.quantity - a.quantity || a.name.localeCompare(b.name)).slice(0, TOP) as ReportProductRow[];

    // the best customers by what they ordered, and the shop's orders by status
    const names = new Map(customersList.map((c) => [c.id, c.name]));
    const byCustomer = new Map<string, ReportCustomerRow>();
    const statuses = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>;
    for (const o of data.orders) {
      if ((ORDER_STATUSES as readonly string[]).includes(o.status)) statuses[o.status as OrderStatus]++;
      if (o.status === "cancelled" || !o.customerId) continue;
      const row = byCustomer.get(o.customerId) ?? { customerId: o.customerId, customerName: names.get(o.customerId) ?? WALK_IN, orders: 0, valueCents: 0 };
      row.orders++;
      row.valueCents += o.totalCents;
      byCustomer.set(o.customerId, row);
    }
    const topCustomers = [...byCustomer.values()].sort((a, b) => b.valueCents - a.valueCents || b.orders - a.orders || a.customerName.localeCompare(b.customerName)).slice(0, TOP);

    // what was spent with each supplier
    const supplierRows = new Map<string, ReportSupplierRow>();
    const supplierNames = new Map((await sqlitePrisma.supplier.findMany({ where: { tenantKey }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));
    for (const s of data.supplierOrders) {
      const row = supplierRows.get(s.supplierId) ?? { supplierId: s.supplierId, supplierName: supplierNames.get(s.supplierId) ?? "—", orders: 0, spentCents: 0 };
      row.orders++;
      row.spentCents += s.totalCents;
      supplierRows.set(s.supplierId, row);
    }
    const suppliers = [...supplierRows.values()].sort((a, b) => b.spentCents - a.spentCents || a.supplierName.localeCompare(b.supplierName));

    return { granularity, year, month, years, current, previous, previousPartial: before?.partial ?? false, series: [...series.values()], byKind, topProducts, topCustomers, statuses, suppliers };
  },

  /** Who owes the shop money today (not a period): the orders that are not cancelled and not fully paid (whatever their status), by customer, the biggest debt first. */
  async debtors(): Promise<ReportDebtors> {
    const tenantKey = await currentTenantKey();
    const [orders, paidRows] = await Promise.all([
      sqlitePrisma.order.findMany({ where: { tenantKey, status: { in: ["confirmed", "at_lab", "ready", "delivered"] } }, select: { id: true, status: true, customerId: true, deliveredAt: true, orderedAt: true, totalCents: true } }),
      sqlitePrisma.payment.groupBy({ by: ["orderId"], where: { tenantKey, orderId: { not: null } }, _sum: { amountCents: true } }),
    ]);
    const paid = new Map(paidRows.map((p) => [p.orderId as string, p._sum.amountCents ?? 0]));
    const out: ReportDebtors = { owedCents: 0, orders: 0, customers: 0, rows: [] };
    const byCustomer = new Map<string, ReportDebtor>();
    for (const o of orders) {
      const left = Math.max(0, o.totalCents - (paid.get(o.id) ?? 0));
      if (left === 0) continue;
      out.owedCents += left;
      out.orders++;
      const key = o.customerId ?? "";
      const since = (o.deliveredAt ?? o.orderedAt).toISOString();
      const row = byCustomer.get(key) ?? { customerId: o.customerId, customerName: WALK_IN, orders: 0, owedCents: 0, since: null };
      row.orders++;
      row.owedCents += left;
      row.since = row.since === null || since < row.since ? since : row.since;
      byCustomer.set(key, row);
    }
    const ids = [...byCustomer.keys()].filter(Boolean);
    const names = new Map((ids.length === 0 ? [] : await sqlitePrisma.customer.findMany({ where: ids.length > 500 ? { tenantKey } : { id: { in: ids } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    for (const row of byCustomer.values()) if (row.customerId) row.customerName = names.get(row.customerId) ?? WALK_IN;
    out.customers = byCustomer.size;
    out.rows = [...byCustomer.values()].sort((a, b) => b.owedCents - a.owedCents || a.customerName.localeCompare(b.customerName)).slice(0, TOP);
    return out;
  },

  /** What the stock is worth today (not a period): the frames and the accessories in stock, at what they cost the shop and at the price they are sold for. */
  async inventory(): Promise<ReportInventory> {
    const tenantKey = await currentTenantKey();
    const select = { stock: true, price: true, costPrice: true } as const;
    const [frames, accessories] = await Promise.all([sqlitePrisma.frame.findMany({ where: { tenantKey }, select }), sqlitePrisma.accessory.findMany({ where: { tenantKey }, select })]);
    const stockOf = (rows: { stock: number; price: number | null; costPrice: number | null }[]): ReportStock => {
      const s: ReportStock = { products: 0, units: 0, costValueCents: 0, priceValueCents: 0, withoutCost: 0, outOfStock: 0 };
      for (const r of rows) {
        if (r.stock <= 0) {
          s.outOfStock++;
          continue;
        }
        s.products++;
        s.units += r.stock;
        s.priceValueCents += cents(r.price ?? 0) * r.stock;
        if (r.costPrice === null || r.costPrice <= 0) s.withoutCost++;
        else s.costValueCents += cents(r.costPrice) * r.stock;
      }
      return s;
    };
    const f = stockOf(frames);
    const a = stockOf(accessories);
    return {
      frames: f,
      accessories: a,
      total: { products: f.products + a.products, units: f.units + a.units, costValueCents: f.costValueCents + a.costValueCents, priceValueCents: f.priceValueCents + a.priceValueCents, withoutCost: f.withoutCost + a.withoutCost },
    };
  },
};
