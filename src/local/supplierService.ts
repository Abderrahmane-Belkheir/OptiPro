import type { NewSupplier, Supplier } from "../services/types";
import { currentTenantKey } from "./context";
import { LocalDbError } from "./errors";
import type { FieldErrors } from "./frameValidation";
import { validateSupplierForm, type SupplierForm } from "./supplierValidation";
import { createLocalTableService } from "./tableService";

/**
 * The suppliers: who the shop buys from (a lab, a frame or lens maker, an accessories seller). A directory: a supplier has a name, what it supplies,
 * how to reach it, and notes. Retiring one keeps it in the records; deleting one removes it here and on the server. (Nothing points at a supplier
 * yet, so any supplier can be deleted; when something does, `usedBy` below counts it and a supplier in use can only be retired.)
 */

const supplierTable = createLocalTableService<Supplier, NewSupplier>({
  table: "suppliers",
  label: "supplier",
  delegate: "supplier",
  orderBy: { name: "asc" },
  syncedDelete: {
    kind: "supplier",
    usedBy: async () => 0,
    usedMessage: (row, count) => `“${String(row.name)}” is used by ${count} ${count === 1 ? "record" : "records"}, so it cannot be deleted.`,
    name: (row) => String(row.name),
  },
});

/** What `create` / `edit` answer: the form's mistakes (nothing was saved), or the saved supplier and whether the server has it. */
export type SaveSupplierResult =
  | { status: "invalid"; errors: FieldErrors }
  | { status: "created" | "updated"; supplier: Supplier; sentToServer: boolean };

const sent = (row: unknown) => (row as { synced?: boolean }).synced === true;
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Two suppliers of one shop do not share a name (capitals do not count). */
async function nameTaken(name: string, exceptId: string | null): Promise<boolean> {
  const all = await supplierTable.list();
  return all.some((s) => s.id !== exceptId && sameName(s.name, name));
}

export const localSupplierService = {
  ...supplierTable,

  /** Saves a new supplier: validated first, then saved and sent like any other row. */
  async create(form: SupplierForm): Promise<SaveSupplierResult> {
    const checked = validateSupplierForm(form);
    if (checked.errors) return { status: "invalid", errors: checked.errors };
    if (await nameTaken(checked.supplier.name, null)) return { status: "invalid", errors: { name: "You already have a supplier with this name." } };
    const supplier = await supplierTable.insert(checked.supplier as unknown as NewSupplier);
    return { status: "created", supplier, sentToServer: sent(supplier) };
  },

  /** Changes a supplier (all its details: send the form as a whole). */
  async edit(id: string, form: SupplierForm): Promise<SaveSupplierResult> {
    if (typeof id !== "string" || !(await supplierTable.get(id))) throw new LocalDbError(`Edit supplier: no supplier "${String(id)}".`, "not-found");
    const checked = validateSupplierForm(form);
    if (checked.errors) return { status: "invalid", errors: checked.errors };
    if (await nameTaken(checked.supplier.name, id)) return { status: "invalid", errors: { name: "You already have a supplier with this name." } };
    const supplier = await supplierTable.update(id, checked.supplier as unknown as Partial<NewSupplier>);
    return { status: "updated", supplier, sentToServer: sent(supplier) };
  },

  /** Retires a supplier (it stays in the records) or brings it back. */
  async setActive(id: string, isActive: boolean): Promise<Supplier> {
    if (typeof isActive !== "boolean") throw new LocalDbError("Set active: give true or false.", "invalid-input");
    if (typeof id !== "string" || !(await supplierTable.get(id))) throw new LocalDbError(`Set active: no supplier "${String(id)}".`, "not-found");
    await currentTenantKey();
    return supplierTable.update(id, { isActive });
  },
};
