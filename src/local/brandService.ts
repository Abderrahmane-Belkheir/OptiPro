import { sqlitePrisma } from "../lib/sqliteClient";
import type { Brand, NewBrand } from "../services/types";
import { createLocalTableService } from "./tableService";

/**
 * Brands behave like every other table: the id is a UUID made on this computer when the brand is created, and that same id is what the
 * server stores, so there is nothing to translate and nothing to remember about the server. Saved here first, then sent (table API:
 * insert, which overwrites the row with the same id), marked synced when the server accepted it. A brand's name is unique within the shop.
 *
 * A brand that has frames cannot be deleted (nothing changes and it says so); one with none can: the row and the outbox entry for the server
 * are written in ONE local transaction, and the server is told right away or by the next sync pass (see tableService.ts).
 */
export const localBrandService = createLocalTableService<Brand, NewBrand>({
  table: "brands",
  label: "brand",
  delegate: "brand",
  orderBy: { name: "asc" },
  syncedDelete: {
    kind: "brand",
    usedBy: (id, tenantKey) => sqlitePrisma.frame.count({ where: { brandId: id, tenantKey } }),
    usedMessage: (row, count) => `“${String(row.name)}” has ${count} ${count === 1 ? "frame" : "frames"}, so it cannot be deleted. Delete or move its frames first.`,
    name: (row) => String(row.name),
  },
});
