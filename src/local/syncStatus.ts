import { sqlitePrisma } from "../lib/sqliteClient";
import { currentTenantKey } from "./context";
import { localAccessoryService } from "./accessoryService";
import { localBrandService } from "./brandService";
import { localCustomerService } from "./customerService";
import { localFrameService } from "./frameService";
import { db } from "./rawDb";

/** True while every local row is synced; checkUnsynced() sets it false when it finds one that isn't. */
export const syncState = { synced: true };

export type UnsyncedRow =
  | { table: "brands"; row: NonNullable<Awaited<ReturnType<typeof localBrandService.get>>> }
  | { table: "frames"; row: NonNullable<Awaited<ReturnType<typeof localFrameService.get>>> }
  | { table: "accessories"; row: NonNullable<Awaited<ReturnType<typeof localAccessoryService.get>>> }
  | { table: "customers"; row: NonNullable<Awaited<ReturnType<typeof localCustomerService.get>>> }
  | { table: ShopTable; row: Record<string, unknown> };

/** The shop-management tables, in the order they depend on each other (parents first). */
const SHOP_TABLES = [
  ["lenses", "lens"],
  ["prescriptions", "prescription"],
  ["orders", "order"],
  ["order_items", "orderItem"],
  ["payments", "payment"],
  ["invoices", "invoice"],
  ["invoice_items", "invoiceItem"],
  ["number_sequences", "numberSequence"],
] as const;
type ShopTable = (typeof SHOP_TABLES)[number][0];

/**
 * Looks for the first row with `synced = false` and returns it with its table. Tables are checked
 * parents first — brands, customers, frames, accessories, then lenses, prescriptions, orders, order
 * lines, payments, invoices, invoice lines, number sequences. Finding one sets `syncState.synced`
 * to false; finding none leaves it true and returns null.
 */
export async function checkUnsynced(): Promise<UnsyncedRow | null> {
  const tenantKey = await currentTenantKey();
  const where = { tenantKey, synced: false };

  const brand = await sqlitePrisma.brand.findFirst({ where, orderBy: { id: "asc" } });
  if (brand) return found({ table: "brands", row: brand });

  const customer = await sqlitePrisma.customer.findFirst({ where, orderBy: { createdAt: "asc" } });
  if (customer) return found({ table: "customers", row: (await localCustomerService.get(customer.id))! });

  const frame = await sqlitePrisma.frame.findFirst({ where, orderBy: { id: "asc" } });
  if (frame) return found({ table: "frames", row: (await localFrameService.get(frame.id))! });

  const accessory = await sqlitePrisma.accessory.findFirst({ where, orderBy: { id: "asc" } });
  if (accessory) return found({ table: "accessories", row: (await localAccessoryService.get(accessory.id))! });

  for (const [table, delegate] of SHOP_TABLES) {
    const row = await db[delegate].findFirst({ where, orderBy: { createdAt: "asc" } });
    if (row) return found({ table, row });
  }

  syncState.synced = true;
  return null;
}

function found(result: UnsyncedRow): UnsyncedRow {
  syncState.synced = false;
  return result;
}
