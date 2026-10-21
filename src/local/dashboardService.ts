import { sqlitePrisma } from "../lib/sqliteClient";
import { currentTenantKey } from "./context";
import { db } from "./rawDb";
import { lastGoodSyncRun, lastSyncRun } from "./syncScheduler";
import { serverContact } from "./tableApiClient";

// What the Dashboard page shows (renderer/pages/dashboard.js). Read-only: nothing here writes. Every figure is for the
// current shop, and "today" is the shop computer's calendar day. Money is in cents. A cancelled order owes nothing and is
// not a sale; every other order owes its total minus what was paid on it.

export interface DashboardSummary {
  /** Money received today. A cheque recorded today but post-dated beyond today is not money in hand yet: it is in chequesLaterCents. */
  collectedCents: number;
  chequesLaterCents: number;
  /** Orders still to be handed over (confirmed, at the lab, ready): what has been paid on them so far (any day), what is still to pay, and how many they are. */
  advanceCents: number;
  pendingRemainingCents: number;
  pendingOrders: number;
  /** Delivered orders that are not fully paid: what is left to pay, and how many orders. */
  owedCents: number;
  owedOrders: number;
  toDeliverCount: number;
}

export interface AttentionOrder {
  id: string;
  number: string;
  customerId: string | null;
  customerName: string;
  promisedAt: string | null;
  /** Set for an order that was handed over. */
  deliveredAt: string | null;
  remainingCents: number;
}

export interface DashboardAttention {
  late: AttentionOrder[];
  cheques: { id: string; customerId: string | null; customerName: string; amountCents: number; dueAt: string }[];
}

export interface DashboardStages {
  ready: AttentionOrder[];
  atLab: AttentionOrder[];
  pickedUp: AttentionOrder[];
}

export interface LowStockItem {
  id: string;
  kind: "frame" | "accessory";
  name: string;
  stock: number;
}

export interface SalesDay {
  day: string;
  totalCents: number;
}

export interface SyncStatus {
  lastSyncedAt: string | null;
  unsyncedCount: number;
  reachable: boolean;
}

const OPEN = ["confirmed", "at_lab", "ready"]; // not yet delivered, not cancelled
const LIST_LIMIT = 20;
const LATE_DAYS = 3;
const PICKED_UP_DAYS = 7;
const CHEQUE_DAYS = 7;
const WALK_IN = "Walk-in customer";

const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dayKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const ORDER_SELECT = { id: true, number: true, customerId: true, promisedAt: true, deliveredAt: true, totalCents: true } as const;

/** What each order has been paid, by order id. */
async function paidByOrder(tenantKey: string, orderIds?: string[]): Promise<Map<string, number>> {
  const rows = await sqlitePrisma.payment.groupBy({
    by: ["orderId"],
    where: { tenantKey, orderId: orderIds ? { in: orderIds } : { not: null } },
    _sum: { amountCents: true },
  });
  return new Map(rows.map((r) => [r.orderId as string, r._sum.amountCents ?? 0]));
}

async function customerNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  if (wanted.length === 0) return new Map();
  const rows = await sqlitePrisma.customer.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

type OrderRow = { id: string; number: string; customerId: string | null; promisedAt: Date | null; deliveredAt: Date | null; totalCents: number };

/** Orders as the dashboard lists them: with the customer's name and what is left to pay. */
async function shapeOrders(tenantKey: string, orders: OrderRow[]): Promise<AttentionOrder[]> {
  const [paid, names] = await Promise.all([paidByOrder(tenantKey, orders.map((o) => o.id)), customerNames(orders.map((o) => o.customerId))]);
  return orders.map((o) => ({
    id: o.id,
    number: o.number,
    customerId: o.customerId,
    customerName: (o.customerId && names.get(o.customerId)) || WALK_IN,
    promisedAt: o.promisedAt?.toISOString() ?? null,
    deliveredAt: o.deliveredAt?.toISOString() ?? null,
    remainingCents: Math.max(0, o.totalCents - (paid.get(o.id) ?? 0)),
  }));
}

export const localDashboardService = {
  /**
   * The money, in three separate things. collected: received today (post-dated cheques apart, they are chequesLater). advance: what has
   * been paid so far, on any day, on the orders not yet handed over; with what is still to pay on them. owed: delivered orders that are
   * not fully paid. A cancelled order is in none of them; a payment with no order is only in "collected". Also the orders still to hand over.
   */
  async today(): Promise<DashboardSummary> {
    const tenantKey = await currentTenantKey();
    const start = startOfDay(new Date());
    const end = addDays(start, 1);
    const [orders, toDeliverCount, paid, received, chequesLater] = await Promise.all([
      sqlitePrisma.order.findMany({ where: { tenantKey, status: { not: "cancelled" } }, select: { id: true, totalCents: true, status: true } }),
      sqlitePrisma.order.count({ where: { tenantKey, status: { in: OPEN }, promisedAt: { lt: end } } }),
      paidByOrder(tenantKey),
      sqlitePrisma.payment.aggregate({ where: { tenantKey, paidAt: { gte: start, lt: end }, OR: [{ chequeDueDate: null }, { chequeDueDate: { lt: end } }] }, _sum: { amountCents: true } }),
      sqlitePrisma.payment.aggregate({ where: { tenantKey, paidAt: { gte: start, lt: end }, chequeDueDate: { gte: end } }, _sum: { amountCents: true } }),
    ]);
    const remaining = (o: { id: string; totalCents: number }) => Math.max(0, o.totalCents - (paid.get(o.id) ?? 0));
    const pending = orders.filter((o) => OPEN.includes(o.status));
    const delivered = orders.filter((o) => o.status === "delivered");
    return {
      collectedCents: received._sum.amountCents ?? 0,
      chequesLaterCents: chequesLater._sum.amountCents ?? 0,
      advanceCents: pending.reduce((sum, o) => sum + (paid.get(o.id) ?? 0), 0),
      pendingRemainingCents: pending.reduce((sum, o) => sum + remaining(o), 0),
      pendingOrders: pending.length,
      owedCents: delivered.reduce((sum, o) => sum + remaining(o), 0),
      owedOrders: delivered.filter((o) => remaining(o) > 0).length,
      toDeliverCount,
    };
  },

  /** late: still being made (confirmed or at the lab) and promised for today, the next 3 days or earlier. cheques: payments by post-dated cheque falling due from today to the next 7 days. */
  async attention(): Promise<DashboardAttention> {
    const tenantKey = await currentTenantKey();
    const today = startOfDay(new Date());
    const lateBefore = addDays(today, LATE_DAYS + 1);
    const chequesBefore = addDays(today, CHEQUE_DAYS + 1);
    const [making, cheques] = await Promise.all([
      sqlitePrisma.order.findMany({ where: { tenantKey, status: { in: ["confirmed", "at_lab"] }, promisedAt: { lt: lateBefore } }, select: ORDER_SELECT, orderBy: [{ promisedAt: "asc" }, { orderedAt: "asc" }], take: LIST_LIMIT }),
      sqlitePrisma.payment.findMany({ where: { tenantKey, chequeDueDate: { gte: today, lt: chequesBefore } }, orderBy: { chequeDueDate: "asc" }, take: LIST_LIMIT }),
    ]);
    const chequeOrders = await sqlitePrisma.order.findMany({
      where: { id: { in: cheques.map((c) => c.orderId).filter((id): id is string => !!id) } },
      select: { id: true, customerId: true },
    });
    const orderCustomer = new Map(chequeOrders.map((o) => [o.id, o.customerId]));
    const chequeCustomerId = (c: { customerId: string | null; orderId: string | null }) => c.customerId ?? (c.orderId ? (orderCustomer.get(c.orderId) ?? null) : null);
    const [late, names] = await Promise.all([shapeOrders(tenantKey, making), customerNames(cheques.map(chequeCustomerId))]);
    return {
      late,
      cheques: cheques.map((c) => {
        const customerId = chequeCustomerId(c);
        return { id: c.id, customerId, customerName: (customerId && names.get(customerId)) || WALK_IN, amountCents: c.amountCents, dueAt: c.chequeDueDate!.toISOString() };
      }),
    };
  },

  /**
   * Where the orders are, as three separate lists. ready: made and waiting for the customer to collect (status "ready"). atLab: every
   * order at the lab, whether late or not. pickedUp: delivered in the last 7 days, newest first. Each is a different stage: an order is in one of them.
   */
  async stages(): Promise<DashboardStages> {
    const tenantKey = await currentTenantKey();
    const since = addDays(startOfDay(new Date()), -(PICKED_UP_DAYS - 1));
    const [ready, atLab, pickedUp] = await Promise.all([
      sqlitePrisma.order.findMany({ where: { tenantKey, status: "ready" }, select: ORDER_SELECT, orderBy: [{ promisedAt: "asc" }, { orderedAt: "asc" }], take: LIST_LIMIT }),
      sqlitePrisma.order.findMany({ where: { tenantKey, status: "at_lab" }, select: ORDER_SELECT, orderBy: [{ promisedAt: "asc" }, { orderedAt: "asc" }], take: LIST_LIMIT }),
      sqlitePrisma.order.findMany({ where: { tenantKey, status: "delivered", deliveredAt: { gte: since } }, select: ORDER_SELECT, orderBy: [{ deliveredAt: "desc" }, { orderedAt: "desc" }], take: LIST_LIMIT }),
    ]);
    const [r, l, p] = await Promise.all([shapeOrders(tenantKey, ready), shapeOrders(tenantKey, atLab), shapeOrders(tenantKey, pickedUp)]);
    return { ready: r, atLab: l, pickedUp: p };
  },

  /** Frames and accessories with fewer than `below` units, fewest first. */
  async lowStock(below: number): Promise<LowStockItem[]> {
    const tenantKey = await currentTenantKey();
    const limit = Number.isFinite(below) ? Math.max(0, Math.floor(below)) : 3;
    const where = { tenantKey, stock: { lt: limit } };
    const select = { id: true, name: true, stock: true } as const;
    const [frames, accessories] = await Promise.all([
      sqlitePrisma.frame.findMany({ where, select, orderBy: [{ stock: "asc" }, { name: "asc" }], take: LIST_LIMIT }),
      sqlitePrisma.accessory.findMany({ where, select, orderBy: [{ stock: "asc" }, { name: "asc" }], take: LIST_LIMIT }),
    ]);
    return [...frames.map((f) => ({ ...f, kind: "frame" as const })), ...accessories.map((a) => ({ ...a, kind: "accessory" as const }))]
      .sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name))
      .slice(0, LIST_LIMIT);
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
   */
  async syncStatus(): Promise<SyncStatus> {
    const tenantKey = await currentTenantKey();
    const tables = ["brand", "customer", "frame", "accessory", "lens", "prescription", "order", "orderItem", "payment", "invoice", "invoiceItem", "numberSequence"];
    const [counts, photos, deletions] = await Promise.all([
      Promise.all(tables.map((t) => db[t].count({ where: { tenantKey, synced: false } }))),
      sqlitePrisma.productImage.count({ where: { synced: false, OR: [{ frame: { is: { tenantKey } } }, { accessory: { is: { tenantKey } } }] } }),
      sqlitePrisma.pendingDeletion.count(),
    ]);
    return {
      lastSyncedAt: lastGoodSyncRun()?.finishedAt ?? null,
      unsyncedCount: counts.reduce((a, b) => a + b, 0) + photos + deletions,
      reachable: serverContact().reachable && lastSyncRun()?.outcome !== "database-unavailable",
    };
  },

  /** One entry per day for the last `days` days, today last; days without a sale are 0 (cancelled orders are not sales). */
  async salesByDay(days: number): Promise<SalesDay[]> {
    const tenantKey = await currentTenantKey();
    const count = Math.min(366, Math.max(1, Math.floor(Number.isFinite(days) ? days : 14)));
    const first = addDays(startOfDay(new Date()), -(count - 1));
    const orders = await sqlitePrisma.order.findMany({ where: { tenantKey, status: { not: "cancelled" }, orderedAt: { gte: first } }, select: { orderedAt: true, totalCents: true } });
    const totals = new Map<string, number>();
    for (const o of orders) totals.set(dayKey(o.orderedAt), (totals.get(dayKey(o.orderedAt)) ?? 0) + o.totalCents);
    return Array.from({ length: count }, (_, i) => {
      const day = dayKey(addDays(first, i));
      return { day, totalCents: totals.get(day) ?? 0 };
    });
  },
};
