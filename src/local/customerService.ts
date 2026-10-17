import { sqlitePrisma } from "../lib/sqliteClient";
import type { Customer, NewCustomer } from "../services/types";
import { customerService as remoteCustomerService } from "../services/customerService";
import { currentTenantKey } from "./context";
import { tryPush } from "./sync";
import { pushRow, registerPusher } from "./syncPush";
import { LocalDbError, translateError } from "./errors";

type CustomerRow = NonNullable<Awaited<ReturnType<typeof sqlitePrisma.customer.findFirst>>>;

function toCustomer(row: CustomerRow): Customer {
  return { ...row, dateOfBirth: row.dateOfBirth?.toISOString() ?? null, createdAt: row.createdAt.toISOString() };
}

/** The date of birth arrives as an ISO string; the database wants a Date. */
function toDatabase<T extends { dateOfBirth?: string | null }>(customer: T): Omit<T, 'dateOfBirth'> & { dateOfBirth?: Date | null } {
  const { dateOfBirth, ...rest } = customer;
  if (dateOfBirth === undefined) return rest;
  if (dateOfBirth === null) return { ...rest, dateOfBirth: null };
  const date = new Date(dateOfBirth);
  if (Number.isNaN(date.getTime())) throw new LocalDbError(`customer: dateOfBirth is not a valid date ("${dateOfBirth}").`, 'invalid-reference');
  return { ...rest, dateOfBirth: date };
}

/**
 * Sends just-saved (inserted or updated) customers to the backend in one request (the local id goes along, so both
 * sides share it) and marks them synced if it accepted them. Returns the rows as they now stand.
 */
export async function pushRows(ids: string[], tenantKey: string): Promise<Customer[]> {
  const rows = await sqlitePrisma.customer.findMany({ where: { id: { in: ids }, tenantKey } });
  await tryPush(`${rows.length} customer(s)`, async () => {
    await remoteCustomerService.upsertMany(
      rows.map(({ id, name, phone, email, address, notes, dateOfBirth }) => ({
        id, name, phone, email, address, notes, dateOfBirth: dateOfBirth?.toISOString() ?? null,
      })),
    );
    await sqlitePrisma.customer.updateMany({ where: { id: { in: ids }, tenantKey }, data: { synced: true } });
  });
  const fresh = await sqlitePrisma.customer.findMany({ where: { id: { in: ids }, tenantKey } });
  return ids.map((id) => toCustomer(fresh.find((r) => r.id === id)!));
}

export const localCustomerService = {
  async list(): Promise<Customer[]> {
    const tenantKey = await currentTenantKey();
    const rows = await sqlitePrisma.customer.findMany({ where: { tenantKey }, orderBy: { name: "asc" } });
    return rows.map(toCustomer);
  },

  async get(id: string): Promise<Customer | null> {
    const tenantKey = await currentTenantKey();
    const row = await sqlitePrisma.customer.findFirst({ where: { id, tenantKey } });
    return row ? toCustomer(row) : null;
  },

  /** Matches `text` anywhere in the name, phone or email (SQLite's LIKE ignores ASCII case). */
  async search(text: string): Promise<Customer[]> {
    const tenantKey = await currentTenantKey();
    const rows = await sqlitePrisma.customer.findMany({
      where: { tenantKey, OR: [{ name: { contains: text } }, { phone: { contains: text } }, { email: { contains: text } }] },
      orderBy: { name: "asc" },
    });
    return rows.map(toCustomer);
  },

  async insert(customer: NewCustomer): Promise<Customer> {
    const tenantKey = await currentTenantKey();
    let created;
    try {
      created = await sqlitePrisma.customer.create({ data: { ...toDatabase(customer), tenantKey } });
    } catch (err) {
      translateError(err, "Insert customer");
    }
    await pushRow("customers", created.id);
    return (await localCustomerService.get(created.id))!;
  },

  /** Inserts all the customers or none of them. */
  async insertMany(customers: NewCustomer[]): Promise<Customer[]> {
    const tenantKey = await currentTenantKey();
    let created;
    try {
      created = await sqlitePrisma.$transaction(customers.map((c) => sqlitePrisma.customer.create({ data: { ...toDatabase(c), tenantKey } })));
    } catch (err) {
      translateError(err, "Insert customers");
    }
    return pushRows(created.map((c) => c.id), tenantKey);
  },

  async update(id: string, changes: Partial<Omit<NewCustomer, "id">>): Promise<Customer> {
    const tenantKey = await currentTenantKey();
    try {
      const { count } = await sqlitePrisma.customer.updateMany({ where: { id, tenantKey }, data: { ...toDatabase(changes), synced: false } });
      if (!count) throw new LocalDbError(`Update customer: no customer "${id}".`, "not-found");
    } catch (err) {
      translateError(err, "Update customer");
    }
    await pushRow("customers", id);
    return (await localCustomerService.get(id))!;
  },

  async remove(id: string): Promise<void> {
    const tenantKey = await currentTenantKey();
    try {
      const { count } = await sqlitePrisma.customer.deleteMany({ where: { id, tenantKey } });
      if (!count) throw new LocalDbError(`Delete customer: no customer "${id}".`, "not-found");
    } catch (err) {
      translateError(err, "Delete customer");
    }
  },
};

registerPusher("customers", (ids, tenantKey) => pushRows(ids as string[], tenantKey));
