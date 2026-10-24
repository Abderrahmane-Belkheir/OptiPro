import { randomUUID } from "node:crypto";
import { sqlitePrisma } from "../lib/sqliteClient";
import { currentTenantKey } from "./context";
import type { FieldErrors } from "./frameValidation";
import { pushRow } from "./syncPush";

/**
 * Placing an order with a supplier for frames and accessories (the New supplier order form: ONE order can hold both). In ONE local transaction (all or nothing):
 *   - the order: the supplier, the way the price was given, what it all cost;
 *   - a line for each product: how many were bought and what ONE cost (a copy, like the lines of a customer's order);
 *   - a product whose stock is 0 gets the quantity bought as its stock, and its cost price becomes what one cost, and its line is marked used. A product that still
 *     has stock keeps both (a shop brings a product in when it has run out, so the cost is never mixed with the cost of pieces still on the shelf): its line is saved
 *     as waiting (not used) and the database applies it when the stock next becomes 0 (see applyWaitingSupplierLines in sqliteClient.ts).
 * A product that already has a line waiting can not be ordered again until that line has been used.
 * The price is given either for each product (a price typed on each line) or once for the whole batch: then what one cost is the batch price shared over all the
 * pieces bought (batch / all the pieces, frames and accessories together), the same for every line, rounded to the centime. The order's total is the sum of the
 * lines (quantity x what one cost) for a price on each line, and the batch price as typed for a batch.
 * Then the order, its lines and the products that changed are sent to the server like any other row (or left for the next sync).
 */

export const MAX_LINES = 200;
export const MAX_QUANTITY = 9999;
/** The largest amount of money in minor units that is stored (a 32-bit whole number). */
const MAX_CENTS = 2_000_000_000;

export interface SupplierOrderLineDraft {
  /** The product: a frame's id OR an accessory's id (one of the two). */
  frameId?: unknown;
  accessoryId?: unknown;
  quantity?: unknown;
  /** The price of ONE piece, as typed ("9500", "9500,50"): needed when the price is given for each line. */
  unitCost?: unknown;
}

export interface SupplierOrderDraft {
  supplierId?: unknown;
  /** unit: a price for each line. batch: one price for the whole order. */
  priceMode?: unknown;
  /** The price of the whole batch, as typed: needed when the price is given for the batch. */
  batchTotal?: unknown;
  notes?: unknown;
  lines?: unknown;
}

export type PlaceSupplierOrderResult =
  | { status: "invalid"; errors: FieldErrors }
  | {
      status: "placed";
      orderId: string;
      /** How many lines (different products) the order has. */
      lines: number;
      /** How many of them had their stock and cost set now (the ones that were at 0). */
      updatedLines: number;
      /** The quantity that went into the stock now (the products that were at 0). */
      addedQuantity: number;
      /** All the pieces bought. */
      quantity: number;
      totalCents: number;
      sentToServer: boolean;
    };

/** An amount as typed ("5000", "5000,50"), in minor units; null when it is empty, NaN when it is not an amount. */
function centsOf(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(",", ".");
  if (text === "") return null;
  return /^\d+(\.\d{1,2})?$/.test(text) ? Math.round(Number(text) * 100) : Number.NaN;
}

function quantityOf(value: unknown): number {
  const n = typeof value === "number" ? value : /^\d+$/.test(String(value ?? "").trim()) ? Number(String(value).trim()) : Number.NaN;
  return Number.isInteger(n) && n >= 1 && n <= MAX_QUANTITY ? n : Number.NaN;
}

type Kind = "frame" | "accessory";
type Checked = { kind: Kind; id: string; quantity: number; unitCost: number | null };
type Line = { kind: Kind; id: string; quantity: number; unitCents: number };

export const localSupplierOrderPlacementService = {
  /**
   * Places the order. Answers { status: "invalid", errors } (nothing is saved; the keys are supplierId, priceMode, batchTotal, lines, and
   * "<id>.quantity" / "<id>.unitCost" / "<id>.waiting" for a line, id being the frame's or the accessory's) or { status: "placed", ... }.
   */
  async place(draft: SupplierOrderDraft): Promise<PlaceSupplierOrderResult> {
    const tenantKey = await currentTenantKey();
    const errors: FieldErrors = {};
    const d = (draft ?? {}) as SupplierOrderDraft;

    const supplier = typeof d.supplierId === "string" && d.supplierId ? await sqlitePrisma.supplier.findFirst({ where: { id: d.supplierId, tenantKey } }) : null;
    if (!supplier) errors.supplierId = "Choose the supplier.";
    else if (!supplier.isActive) errors.supplierId = `${supplier.name} is retired: choose another supplier.`;

    const mode = d.priceMode === "batch" ? "batch" : d.priceMode === "unit" ? "unit" : null;
    if (mode === null) errors.priceMode = "Say how the price is given: for each product, or for the whole batch.";

    const rawLines = Array.isArray(d.lines) ? (d.lines as SupplierOrderLineDraft[]) : [];
    if (rawLines.length === 0) errors.lines = "Add at least one product.";
    else if (rawLines.length > MAX_LINES) errors.lines = `An order holds at most ${MAX_LINES} products.`;

    const checked: Checked[] = [];
    const seen = new Set<string>();
    if (rawLines.length > 0 && rawLines.length <= MAX_LINES) {
      for (const raw of rawLines) {
        const frameId = typeof raw?.frameId === "string" && raw.frameId ? raw.frameId : null;
        const accessoryId = typeof raw?.accessoryId === "string" && raw.accessoryId ? raw.accessoryId : null;
        const id = frameId ?? accessoryId;
        if (!id || (frameId && accessoryId)) {
          errors.lines = "A line must have a frame or an accessory.";
          continue;
        }
        const kind: Kind = frameId ? "frame" : "accessory";
        if (seen.has(`${kind}:${id}`)) {
          errors.lines = "A product is in the order twice.";
          continue;
        }
        seen.add(`${kind}:${id}`);
        const product = frameId
          ? await sqlitePrisma.frame.findFirst({ where: { id, tenantKey }, select: { name: true } })
          : await sqlitePrisma.accessory.findFirst({ where: { id, tenantKey }, select: { name: true } });
        if (!product) {
          errors.lines = "A product of the order no longer exists.";
          continue;
        }
        // a product that already has a line waiting (not used yet) in a supplier order can not be ordered again until that line has been used
        const waiting = await sqlitePrisma.supplierOrderItem.findFirst({
          where: { ...(frameId ? { frameId: id } : { accessoryId: id }), tenantKey, used: false, supplierOrder: { is: { status: { not: "cancelled" } } } },
          select: { id: true },
        });
        if (waiting) {
          errors[`${id}.waiting`] = `${product.name} already has an order waiting: it can be ordered again once that order has been used.`;
          continue;
        }
        const quantity = quantityOf(raw.quantity);
        if (Number.isNaN(quantity)) errors[`${id}.quantity`] = `The quantity of ${product.name} must be a whole number from 1 to ${MAX_QUANTITY}.`;
        let unitCost: number | null = null;
        if (mode === "unit") {
          const cents = centsOf(raw.unitCost);
          if (cents === null) errors[`${id}.unitCost`] = `Give the price of one ${product.name}.`;
          else if (Number.isNaN(cents) || cents <= 0 || cents > MAX_CENTS) errors[`${id}.unitCost`] = `The price of one ${product.name} must be an amount above 0, like 9500 or 9500.50.`;
          else unitCost = cents;
        }
        checked.push({ kind, id, quantity, unitCost });
      }
    }

    // The batch price shared over the pieces bought.
    let batchCents: number | null = null;
    if (mode === "batch") {
      const cents = centsOf(d.batchTotal);
      if (cents === null) errors.batchTotal = "Give the price of the whole batch.";
      else if (Number.isNaN(cents) || cents <= 0 || cents > MAX_CENTS) errors.batchTotal = "The price of the whole batch must be an amount above 0, like 250000 or 250000.50.";
      else batchCents = cents;
    }

    const notes = typeof d.notes === "string" && d.notes.trim() ? d.notes.trim().slice(0, 2000) : null;
    if (Object.keys(errors).length > 0 || !supplier) return { status: "invalid", errors };

    const piecesBought = checked.reduce((sum, l) => sum + l.quantity, 0);
    const shared = batchCents !== null ? Math.round(batchCents / piecesBought) : null;
    const lines: Line[] = checked.map((l) => ({ kind: l.kind, id: l.id, quantity: l.quantity, unitCents: shared ?? l.unitCost! }));
    for (const line of lines) {
      if (line.unitCents <= 0 || line.unitCents * line.quantity > MAX_CENTS) {
        // (a batch price too small to share over so many pieces leaves less than a centime for each; a total too big does not fit)
        return { status: "invalid", errors: mode === "batch" ? { batchTotal: "This price cannot be shared over these products: check the price and the quantities." } : { [`${line.id}.unitCost`]: "This price times the quantity is too large." } };
      }
    }
    const totalCents = batchCents ?? lines.reduce((sum, l) => sum + l.unitCents * l.quantity, 0);
    if (totalCents > MAX_CENTS) return { status: "invalid", errors: { lines: "The order is too large." } };

    const orderId = randomUUID();
    const lineIds = lines.map(() => randomUUID());
    const updated: Line[] = [];
    await sqlitePrisma.$transaction(async (tx) => {
      await tx.supplierOrder.create({ data: { id: orderId, supplierId: supplier.id, tenantKey, priceMode: mode!, totalCents, status: "received", notes } });
      for (const [index, line] of lines.entries()) {
        // the products arrive: ONLY a product whose stock is 0 gets the quantity as its stock and what one cost as its cost. It is marked unsent so the server gets both.
        const data = { stock: line.quantity, costPrice: line.unitCents / 100, synced: false };
        const changed =
          line.kind === "frame"
            ? await tx.frame.updateMany({ where: { id: line.id, tenantKey, stock: 0 }, data })
            : await tx.accessory.updateMany({ where: { id: line.id, tenantKey, stock: 0 }, data });
        if (changed.count > 0) updated.push(line);
        // the line says whether it was the one that set the product's stock and cost (used) or the product still had stock
        await tx.supplierOrderItem.create({
          data: {
            id: lineIds[index], supplierOrderId: orderId, tenantKey, frameId: line.kind === "frame" ? line.id : null, accessoryId: line.kind === "accessory" ? line.id : null,
            quantity: line.quantity, unitCostCents: line.unitCents, used: changed.count > 0,
          },
        });
      }
    });

    // Sent parents first (the order, then its lines, then the products). None of these throws when the server cannot be reached.
    // (the products whose stock and cost just changed go BEFORE the lines that point at them: a line is held back while its product is unsent)
    await pushRow("supplier_orders", orderId);
    for (const line of updated) await pushRow(line.kind === "frame" ? "frames" : "accessories", line.id);
    for (const lineId of lineIds) await pushRow("supplier_order_items", lineId);

    const rows = [
      ...(await sqlitePrisma.supplierOrder.findMany({ where: { id: orderId, tenantKey }, select: { synced: true } })),
      ...(await sqlitePrisma.supplierOrderItem.findMany({ where: { supplierOrderId: orderId, tenantKey }, select: { synced: true } })),
      ...(await sqlitePrisma.frame.findMany({ where: { id: { in: updated.filter((l) => l.kind === "frame").map((l) => l.id) }, tenantKey }, select: { synced: true } })),
      ...(await sqlitePrisma.accessory.findMany({ where: { id: { in: updated.filter((l) => l.kind === "accessory").map((l) => l.id) }, tenantKey }, select: { synced: true } })),
    ];
    return {
      status: "placed",
      orderId,
      lines: lines.length,
      updatedLines: updated.length,
      addedQuantity: updated.reduce((sum, l) => sum + l.quantity, 0),
      quantity: piecesBought,
      totalCents,
      sentToServer: rows.every((r) => r.synced === true),
    };
  },
};
