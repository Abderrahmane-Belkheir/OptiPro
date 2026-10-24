import { sqlitePrisma } from "../lib/sqliteClient";
import { currentTenantKey } from "./context";
import { LocalDbError } from "./errors";
import { searchSupplierProducts } from "./productSearch";
import { periodFrom } from "./salesService";
import { localSupplierOrderPlacementService } from "./supplierOrderPlacement";

/**
 * The supplier orders of the shop: placing one (supplierOrderPlacement.ts), the list of them, and one order with its lines.
 * Read-only apart from placing: an order is never changed or deleted here.
 */

export interface SupplierOrderRow {
  id: string;
  supplierId: string;
  supplierName: string;
  orderedAt: string;
  /** unit: a price for each frame. batch: one price for the whole order. */
  priceMode: string;
  totalCents: number;
  /** received | cancelled */
  status: string;
  /** How many different products (frames and accessories) are in it, and how many pieces in all. */
  products: number;
  quantity: number;
}

export interface SupplierOrderLine {
  id: string;
  frameId: string | null;
  accessoryId: string | null;
  /** The product as the shop knows it: "Ray-Ban Aviator" (a brand and a name), or just the accessory's name. */
  name: string;
  code: string | null;
  quantity: number;
  /** What ONE cost. */
  unitCostCents: number;
  /** quantity x what one cost. */
  totalCents: number;
  /** True when this line set the frame's stock and cost; false while it waits for the frame's last piece to be sold. */
  used: boolean;
}

export interface SupplierOrderDetails extends SupplierOrderRow {
  notes: string | null;
  lines: SupplierOrderLine[];
}

/** The supplier orders of a period, with what they add up to. */
export interface SupplierOrdersList {
  /** The orders of the period, newest first (at most SUPPLIER_ORDERS_LIMIT). */
  rows: SupplierOrderRow[];
  /** The years that have at least one order (newest first), for the year choice. */
  years: number[];
  totals: {
    /** How many orders the period holds, the cancelled ones not counted. */
    orders: number;
    /** What they cost in all, in minor units (the total of each order), the cancelled ones not counted. */
    spentCents: number;
    /** How many cancelled orders the period holds (they are listed, and are not in the two numbers above). */
    cancelledOrders: number;
  };
}

/** The most orders the list holds (the newest ones). */
export const SUPPLIER_ORDERS_LIMIT = 500;

export const localSupplierOrdersService = {
  ...localSupplierOrderPlacementService,

  /** The frames and accessories that can be put in a new order (those with no line waiting in an earlier order), by model or by code. See productSearch.ts. */
  searchProducts: searchSupplierProducts,

  /**
   * The shop's supplier orders, newest first (at most SUPPLIER_ORDERS_LIMIT), of a period when filter.year (and filter.month, which needs a year) is given, in the
   * shop's local time; with how many there are and what they cost in all (a cancelled order is listed but not counted, it cost nothing).
   */
  async list(filter: { year?: number; month?: number } = {}): Promise<SupplierOrdersList> {
    const tenantKey = await currentTenantKey();
    const period = periodFrom({ year: filter?.year, month: filter?.month });
    const where = { tenantKey, ...(period ? { orderedAt: { gte: period.gte, lt: period.lt } } : {}) };
    const [all, inPeriod] = await Promise.all([
      sqlitePrisma.supplierOrder.findMany({ where: { tenantKey }, select: { orderedAt: true } }),
      sqlitePrisma.supplierOrder.findMany({ where, select: { status: true, totalCents: true } }),
    ]);
    const years = [...new Set(all.map((o) => o.orderedAt.getFullYear()))].sort((a, b) => b - a);
    const counted = inPeriod.filter((o) => o.status !== "cancelled");
    const totals = { orders: counted.length, spentCents: counted.reduce((sum, o) => sum + o.totalCents, 0), cancelledOrders: inPeriod.length - counted.length };
    const orders = await sqlitePrisma.supplierOrder.findMany({
      where,
      orderBy: [{ orderedAt: "desc" }, { id: "asc" }],
      take: SUPPLIER_ORDERS_LIMIT,
      include: { supplier: { select: { name: true } }, items: { select: { quantity: true } } },
    });
    const rows = orders.map((o) => ({
      id: o.id,
      supplierId: o.supplierId,
      supplierName: o.supplier.name,
      orderedAt: o.orderedAt.toISOString(),
      priceMode: o.priceMode,
      totalCents: o.totalCents,
      status: o.status,
      products: o.items.length,
      quantity: o.items.reduce((sum, i) => sum + i.quantity, 0),
    }));
    return { rows, years, totals };
  },

  /** One order with its lines, in the order they were added. Refused when the id is not one of the shop's orders. */
  async get(id: unknown): Promise<SupplierOrderDetails> {
    if (typeof id !== "string" || !id) throw new LocalDbError("Supplier order: give the order's id.", "invalid-input");
    const tenantKey = await currentTenantKey();
    const order = await sqlitePrisma.supplierOrder.findFirst({
      where: { id, tenantKey },
      include: { supplier: { select: { name: true } }, items: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
    });
    if (!order) throw new LocalDbError(`Supplier order ${id} was not found.`, "not-found");

    const lines: SupplierOrderLine[] = [];
    for (const item of order.items) {
      let name = "A product that no longer exists";
      let code: string | null = null;
      if (item.frameId) {
        const frame = await sqlitePrisma.frame.findFirst({ where: { id: item.frameId, tenantKey }, include: { brand: { select: { name: true } } } });
        if (frame) {
          name = [frame.brand?.name, frame.name].filter(Boolean).join(" ");
          code = frame.code ?? null;
        }
      } else if (item.accessoryId) {
        const accessory = await sqlitePrisma.accessory.findFirst({ where: { id: item.accessoryId, tenantKey } });
        if (accessory) {
          name = accessory.name;
          code = accessory.code ?? null;
        }
      }
      lines.push({
        id: item.id,
        frameId: item.frameId,
        accessoryId: item.accessoryId,
        name,
        code,
        quantity: item.quantity,
        unitCostCents: item.unitCostCents,
        totalCents: item.unitCostCents * item.quantity,
        used: item.used,
      });
    }
    return {
      id: order.id,
      supplierId: order.supplierId,
      supplierName: order.supplier.name,
      orderedAt: order.orderedAt.toISOString(),
      priceMode: order.priceMode,
      totalCents: order.totalCents,
      status: order.status,
      products: lines.length,
      quantity: lines.reduce((sum, l) => sum + l.quantity, 0),
      notes: order.notes,
      lines,
    };
  },
};
