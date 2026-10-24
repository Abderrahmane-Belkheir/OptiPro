import { sqlitePrisma } from "../lib/sqliteClient";
import { currentTenantKey } from "./context";
import { db } from "./rawDb";
import { localReportsService } from "./reportsService";
import { localSalesService, periodFrom } from "./salesService";
import { lastGoodSyncRun, lastSyncRun } from "./syncScheduler";
import { serverContact } from "./tableApiClient";

// What the Dashboard page shows (renderer/pages/dashboard.js). Read-only: nothing here writes. Every figure is for the current shop, in the shop computer's local
// time, and money is in cents. A cancelled order is not a sale.
//
// month(): the figures of the CURRENT MONTH: the orders placed (how many and what they are worth), what was spent with the suppliers, and the profit of those
// orders in two parts: the TOTAL profit (the final price of each order minus what its lines cost on the day of the sale, collected or not) and the profit COLLECTED so
// far (what the customers have really paid on those orders minus their costs: negative while the payments do not cover the costs yet, and equal to the total profit once
// the orders are paid up). What is left to collect is the difference. owed(): not a month but everything until now: who owes the shop money (delivered orders not fully
// paid), the biggest debts first. ready(): every order that is made and waiting for the customer to collect it, whatever its month.
//
// An order with a line whose cost was not known has an unknown profit: it is counted apart (withoutCostOrders), not passed off as pure profit.

export interface DashboardMonth {
  year: number;
  month: number;
  /** Orders placed this month (the cancelled ones not counted) and what they are worth. */
  orders: number;
  salesCents: number;
  /** What the supplier orders (frames and accessories) of this month cost, and how many they are. */
  purchasesCents: number;
  purchaseOrders: number;
  /** The profit of the orders of this month, collected or not (profitOrders of them have a known cost; withoutCostOrders do not and are left out). */
  profitCents: number;
  /** The part of it that has been collected: the payments received on those orders minus their costs. */
  collectedProfitCents: number;
  /** What is still to collect of the profit (profit minus collected). */
  toCollectCents: number;
  profitOrders: number;
  withoutCostOrders: number;
}

export interface DashboardOwed {
  /** What customers owe the shop: orders that are not cancelled and not fully paid (the customer's page adds up the same), since the start, over how many orders and customers. */
  owedCents: number;
  orders: number;
  customers: number;
  /** The customers who owe the most, biggest first. */
  rows: { customerId: string | null; customerName: string; orders: number; owedCents: number; since: string | null }[];
}

export interface ReadyOrder {
  id: string;
  number: string;
  customerId: string | null;
  customerName: string;
  promisedAt: string | null;
  remainingCents: number;
}

export interface DashboardReady {
  /** Every order that is ready and not yet collected, and what is still to pay on them. */
  count: number;
  remainingCents: number;
  /** The first of them (the oldest promise first), at most LIST_LIMIT. */
  rows: ReadyOrder[];
}

export interface SyncStatus {
  lastSyncedAt: string | null;
  unsyncedCount: number;
  reachable: boolean;
}

const LIST_LIMIT = 20;
const WALK_IN = "Walk-in customer";

export const localDashboardService = {
  async month(): Promise<DashboardMonth> {
    const tenantKey = await currentTenantKey();
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const range = periodFrom({ year, month })!;
    // the orders of the month and their profit: the same figures as the Orders page (cancelled orders left out)
    const [sales, purchases] = await Promise.all([
      localSalesService.list({ year, month, limit: 1 }),
      sqlitePrisma.supplierOrder.aggregate({ where: { tenantKey, status: { not: "cancelled" }, orderedAt: range }, _sum: { totalCents: true }, _count: { _all: true } }),
    ]);
    const t = sales.totals;
    return {
      year,
      month,
      orders: t.orders,
      salesCents: t.valueCents,
      purchasesCents: purchases._sum.totalCents ?? 0,
      purchaseOrders: purchases._count._all,
      profitCents: t.profitCents,
      collectedProfitCents: t.collectedProfitCents,
      toCollectCents: t.profitCents - t.collectedProfitCents,
      profitOrders: t.profitOrders,
      withoutCostOrders: t.withoutCostOrders,
    };
  },

  /** Who owes the shop money, from the very start: the total, and the customers who owe the most. */
  async owed(): Promise<DashboardOwed> {
    const d = await localReportsService.debtors();
    return { owedCents: d.owedCents, orders: d.orders, customers: d.customers, rows: d.rows };
  },

  /** The orders that are ready and waiting for the customer, whatever their month. */
  async ready(): Promise<DashboardReady> {
    const tenantKey = await currentTenantKey();
    const orders = await sqlitePrisma.order.findMany({
      where: { tenantKey, status: "ready" },
      select: { id: true, number: true, customerId: true, promisedAt: true, totalCents: true },
      orderBy: [{ promisedAt: "asc" }, { orderedAt: "asc" }],
    });
    const paidRows = orders.length ? await sqlitePrisma.payment.groupBy({ by: ["orderId"], where: { tenantKey, orderId: { in: orders.map((o) => o.id) } }, _sum: { amountCents: true } }) : [];
    const paid = new Map(paidRows.map((p) => [p.orderId as string, p._sum.amountCents ?? 0]));
    const left = (o: { id: string; totalCents: number }) => Math.max(0, o.totalCents - (paid.get(o.id) ?? 0));
    const shown = orders.slice(0, LIST_LIMIT);
    const ids = [...new Set(shown.map((o) => o.customerId).filter((id): id is string => !!id))];
    const names = new Map((ids.length ? await sqlitePrisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []).map((c) => [c.id, c.name]));
    return {
      count: orders.length,
      remainingCents: orders.reduce((sum, o) => sum + left(o), 0),
      rows: shown.map((o) => ({ id: o.id, number: o.number, customerId: o.customerId, customerName: (o.customerId && names.get(o.customerId)) || WALK_IN, promisedAt: o.promisedAt?.toISOString() ?? null, remainingCents: left(o) })),
    };
  },

  /** The five newest customers. */
  async recentCustomers(): Promise<{ id: string; name: string; createdAt: string }[]> {
    const tenantKey = await currentTenantKey();
    const rows = await sqlitePrisma.customer.findMany({ where: { tenantKey }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, name: true, createdAt: true } });
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  },

  /**
   * lastSyncedAt: the end of the last pass that reached the server without an error. unsyncedCount: rows (and photos and
   * deletions) the server has not been told about. reachable: false when the latest call to the server could not reach it.
   * (The Dashboard does not show it any more; it stays for whoever needs to know where the sync stands.)
   */
  async syncStatus(): Promise<SyncStatus> {
    const tenantKey = await currentTenantKey();
    const tables = ["brand", "customer", "frame", "accessory", "lens", "supplier", "supplierOrder", "supplierOrderItem", "prescription", "order", "orderItem", "payment", "invoice", "invoiceItem", "numberSequence"];
    const [counts, photos, deletions, shopInfo] = await Promise.all([
      Promise.all(tables.map((t) => db[t].count({ where: { tenantKey, synced: false } }))),
      sqlitePrisma.productImage.count({ where: { synced: false, OR: [{ frame: { is: { tenantKey } } }, { accessory: { is: { tenantKey } } }] } }),
      sqlitePrisma.pendingDeletion.count(),
      sqlitePrisma.licenseExpiry.count({ where: { synced: false } }), // the shop's details edited in the settings, not yet confirmed by the server
    ]);
    return {
      lastSyncedAt: lastGoodSyncRun()?.finishedAt ?? null,
      unsyncedCount: counts.reduce((a, b) => a + b, 0) + photos + deletions + shopInfo,
      reachable: serverContact().reachable && lastSyncRun()?.outcome !== "database-unavailable",
    };
  },
};
