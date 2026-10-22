import { randomUUID } from "node:crypto";
import { sqlitePrisma } from "../lib/sqliteClient";
import type { Order } from "../services/types";
import { currentTenantKey } from "./context";
import type { FieldErrors } from "./frameValidation";
import { validateOrderDraft, type OrderDraft } from "./orderDraft";
import { pushRow } from "./syncPush";
import { localNumberService, localOrderService } from "./shopServices";

/**
 * Placing an order: what the New order form sends (checked in orderDraft.ts), then saved in ONE local transaction (the order, its lines and the
 * deposit payment: all or nothing) and sent to the server like any other row (or left for the next sync).
 *
 * What an order holds:
 *   - the customer, and optionally one of THEIR prescriptions (a prescription an order uses can no longer be changed, so the order always
 *     shows the powers it was made for);
 *   - lines, each with the description and the price as they were at the sale (a later change to the catalogue does not touch the order):
 *       frame      one line, quantity 1, price = the frame's price
 *       accessory  one line, quantity 1, price = the accessory's price
 *       lens       one line for the pair (eye "both", quantity 1). The price is the price of the pair as the shop charges it: the catalogue
 *                  lens's price unless a price is typed, which overrides it. A lens can be described in words instead of picked from the
 *                  catalogue: then no lens is linked and the typed price is required;
 *   - what was measured with the frame on: PD and fitting height of each eye (they belong to the job, not to the prescription);
 *   - the deposit, as a payment taken now, never more than the total.
 *
 * A lens from the catalogue is chosen FOR a prescription, so it needs one. A described lens does not.
 * Money is typed in the shop's currency (5000 or "5000,50") and stored in centimes.
 */

export type PlaceOrderResult =
  | { status: "invalid"; errors: FieldErrors }
  | { status: "placed"; order: Order; lines: number; depositCents: number; totalCents: number; sentToServer: boolean; /** Whether the order has a lens (then there is something for the lab to make). */ hasLens: boolean };

/** A price kept as a decimal number of the shop's currency (frames and accessories) in centimes; null when it has none. */
const centsOf = (price: number | null | undefined): number | null => (typeof price === "number" && Number.isFinite(price) && price >= 0 ? Math.round(price * 100) : null);

export const localOrderPlacementService = {
  /**
   * Places an order. Nothing is saved when something is wrong: the answer is { status: "invalid", errors } with a sentence for each field
   * (customerId, prescriptionId, frameId, accessoryId, lensId, lensDescription, lensPrice, deposit, pdRight, ..., items). When it is saved
   * the order is numbered (and confirmed, or delivered at once when it has no lens: nothing to make) (CMD-2026-0042) and on its way to the server; sentToServer says whether the server already has all of it.
   */
  async place(draft: OrderDraft): Promise<PlaceOrderResult> {
    const checked = validateOrderDraft(draft);
    if (checked.errors) return { status: "invalid", errors: checked.errors };
    const d = checked.draft;
    const tenantKey = await currentTenantKey();
    const errors: FieldErrors = {};

    const customer = await sqlitePrisma.customer.findFirst({ where: { id: d.customerId, tenantKey }, select: { id: true } });
    if (!customer) errors.customerId = "This customer no longer exists.";
    if (d.prescriptionId) {
      const rx = await sqlitePrisma.prescription.findFirst({ where: { id: d.prescriptionId, tenantKey }, select: { customerId: true } });
      if (!rx) errors.prescriptionId = "This prescription no longer exists.";
      else if (rx.customerId !== d.customerId) errors.prescriptionId = "This prescription belongs to another customer.";
    }

    type Line = { kind: string; frameId?: string; lensId?: string; accessoryId?: string; description: string; eye: string | null; unitPriceCents: number };
    const lines: Line[] = [];

    if (d.frameId) {
      const frame = await sqlitePrisma.frame.findFirst({ where: { id: d.frameId, tenantKey } });
      const cents = frame ? centsOf(frame.price) : null;
      if (!frame) errors.frameId = "This frame no longer exists.";
      else if (cents === null) errors.frameId = `${frame.name} has no price: set one on the frame first.`;
      else {
        const brand = await sqlitePrisma.brand.findFirst({ where: { id: frame.brandId, tenantKey }, select: { name: true } });
        lines.push({ kind: "frame", frameId: frame.id, description: [brand?.name, frame.name].filter(Boolean).join(" "), eye: null, unitPriceCents: cents });
      }
    }
    if (d.accessoryId) {
      const accessory = await sqlitePrisma.accessory.findFirst({ where: { id: d.accessoryId, tenantKey } });
      const cents = accessory ? centsOf(accessory.price) : null;
      if (!accessory) errors.accessoryId = "This accessory no longer exists.";
      else if (cents === null) errors.accessoryId = `${accessory.name} has no price: set one on the accessory first.`;
      else lines.push({ kind: "accessory", accessoryId: accessory.id, description: accessory.name, eye: null, unitPriceCents: cents });
    }
    if (d.lensId) {
      const lens = await sqlitePrisma.lens.findFirst({ where: { id: d.lensId, tenantKey } });
      if (!lens) errors.lensId = "This lens no longer exists.";
      else if (!lens.isActive) errors.lensId = `${lens.name} is retired: choose another lens.`;
      else lines.push({ kind: "lens", lensId: lens.id, description: [lens.brand, lens.name].filter(Boolean).join(" "), eye: "both", unitPriceCents: d.lensPriceCents ?? lens.priceCents });
    } else if (d.lensDescription) {
      lines.push({ kind: "lens", description: d.lensDescription, eye: "both", unitPriceCents: d.lensPriceCents! });
    }

    const subtotalCents = lines.reduce((sum, line) => sum + line.unitPriceCents, 0);
    if (!errors.deposit && d.depositCents > subtotalCents && Object.keys(errors).length === 0) errors.deposit = "The deposit cannot be more than the order's total.";
    if (Object.keys(errors).length > 0) return { status: "invalid", errors };

    // The number is saved before the order: a number is never reused, so a failure below leaves a gap, never a duplicate.
    // Nothing to make (no lens, from the list or described): the customer leaves with it, so the order is delivered at once. With a lens it waits for the lab.
    const status = d.lensId || d.lensDescription ? "confirmed" : "delivered";
    const number = await localNumberService.next("order");
    const id = randomUUID();
    const now = new Date();
    const paymentId = d.depositCents > 0 ? randomUUID() : null;
    const lineIds = lines.map(() => randomUUID());

    await sqlitePrisma.$transaction(async (tx) => {
      await tx.order.create({
        data: {
          id, number, tenantKey, customerId: d.customerId, prescriptionId: d.prescriptionId, status, orderedAt: now, deliveredAt: status === "delivered" ? now : null,
          promisedAt: d.promisedAt ? new Date(`${d.promisedAt}T00:00:00.000Z`) : null,
          subtotalCents, discountCents: 0, totalCents: subtotalCents, notes: d.notes,
          pdRight: d.pdRight, pdLeft: d.pdLeft, fittingHeightRight: d.fittingHeightRight, fittingHeightLeft: d.fittingHeightLeft,
        },
      });
      for (const [index, line] of lines.entries()) {
        await tx.orderItem.create({
          data: {
            id: lineIds[index], orderId: id, tenantKey, kind: line.kind, frameId: line.frameId ?? null, lensId: line.lensId ?? null, accessoryId: line.accessoryId ?? null,
            description: line.description, eye: line.eye, quantity: 1, unitPriceCents: line.unitPriceCents, totalCents: line.unitPriceCents,
          },
        });
      }
      if (paymentId) await tx.payment.create({ data: { id: paymentId, orderId: id, customerId: d.customerId, tenantKey, amountCents: d.depositCents, paidAt: now } });
    });

    // Sent parents first (the order, then what refers to it). Neither call throws when the server cannot be reached.
    await pushRow("orders", id);
    for (const lineId of lineIds) await pushRow("order_items", lineId);
    if (paymentId) await pushRow("payments", paymentId);

    const order = (await localOrderService.get(id))!;
    const rows = [order as unknown as { synced?: boolean }, ...(await sqlitePrisma.orderItem.findMany({ where: { orderId: id, tenantKey }, select: { synced: true } })), ...(paymentId ? await sqlitePrisma.payment.findMany({ where: { id: paymentId, tenantKey }, select: { synced: true } }) : [])];
    return { status: "placed", order, lines: lines.length, depositCents: d.depositCents, totalCents: subtotalCents, sentToServer: rows.every((row) => row.synced === true), hasLens: Boolean(d.lensId || d.lensDescription) };
  },
};
