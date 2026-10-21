import { sqlitePrisma } from "../lib/sqliteClient";
import type { Customer, NewCustomer } from "../services/types";
import { currentTenantKey } from "./context";
import { tryPush } from "./sync";
import { pushRow, registerPusher } from "./syncPush";
import { markSyncedIfUnchanged, pushInsertRows, reportPushOutcome, toApiRow } from "./tableSync";
import { LocalDbError, translateError } from "./errors";
import { attemptDeletion, queueDeletionIn } from "./pendingDeletions";

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
 * Sends just-saved (inserted or updated) customers to the server (the table API: insert, which overwrites a row with the same id;
 * the local id goes along, so both sides share it) and marks the ones it accepted synced. Returns the rows as they now stand.
 */
export async function pushRows(ids: string[], tenantKey: string): Promise<Customer[]> {
  const rows = await sqlitePrisma.customer.findMany({ where: { id: { in: ids }, tenantKey } });
  await tryPush(`${rows.length} customer(s)`, async () => {
    const outcome = await pushInsertRows("customers", rows.map((row) => ({ id: row.id, row: toApiRow(row) })));
    await markSyncedIfUnchanged((tx) => tx.customer, tenantKey, new Map(rows.map((row) => [row.id, row])), outcome.accepted);
    reportPushOutcome(outcome);
  });
  const fresh = await sqlitePrisma.customer.findMany({ where: { id: { in: ids }, tenantKey } });
  return ids.map((id) => toCustomer(fresh.find((r) => r.id === id)!));
}

/** What `delete` answers. */
export interface DeleteCustomerResult {
  status: "deleted";
  id: string;
  name: string;
  /** True when the server has deleted it (or never had it); false when it could not be told yet (the sync tells it later). */
  sentToServer: boolean;
  /** Why the server was not told, when it was not. */
  reason?: string;
  steps: string[];
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

  /**
   * Deletes a customer here and on the server. ONLY a customer that nothing refers to can be deleted: no prescription, order,
   * payment or invoice (a customer made by mistake or for a test can go; one with any history cannot: it says what they have and
   * nothing changes). In this order:
   *   1. the check above (and the local database's own foreign keys, RESTRICT, say the same if anything gets around it);
   *   2. ONE local transaction: the customer's row is deleted and the deletion is written to the outbox. A crash leaves the customer
   *      and no entry, or no customer and the entry, never half of it;
   *   3. the server is asked right away (POST /api/table/customers?action=delete { id });
   *   4. when the server confirms, the outbox entry is removed (done by the outbox); otherwise it stays and the sync pass retries.
   * Logged as "[delete customer] n. ...".
   */
  async delete(id: string): Promise<DeleteCustomerResult> {
    const steps: string[] = [];
    const step = (text: string) => {
      steps.push(text);
      console.info(`[delete customer] ${steps.length}. ${text}`);
    };
    const tenantKey = await currentTenantKey();
    const customer = await sqlitePrisma.customer.findFirst({ where: { id, tenantKey }, select: { id: true, name: true } });
    if (!customer) throw new LocalDbError(`Delete customer: no customer "${id}".`, "not-found");

    const has = [
      [await sqlitePrisma.prescription.count({ where: { customerId: id, tenantKey } }), "prescription", "prescriptions"],
      [await sqlitePrisma.order.count({ where: { customerId: id, tenantKey } }), "order", "orders"],
      [await sqlitePrisma.payment.count({ where: { customerId: id, tenantKey } }), "payment", "payments"],
      [await sqlitePrisma.invoice.count({ where: { customerId: id, tenantKey } }), "invoice", "invoices"],
    ] as const;
    const parts = has.filter(([count]) => count > 0).map(([count, one, many]) => `${count} ${count === 1 ? one : many}`);
    if (parts.length > 0) {
      const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
      throw new LocalDbError(`${customer.name} has ${list}, so the customer cannot be deleted. Only a customer with no prescriptions, orders, payments or invoices can be deleted.`, "invalid-reference");
    }

    try {
      await sqlitePrisma.$transaction(async (tx) => {
        await tx.customer.deleteMany({ where: { id, tenantKey } });
        await queueDeletionIn(tx, "customer", id);
      });
    } catch (err) {
      if (err instanceof Error && /P2003|foreign key/i.test(`${(err as { code?: string }).code ?? ""} ${err.message}`)) {
        throw new LocalDbError(`${customer.name} has records that refer to them, so the customer cannot be deleted.`, "invalid-reference");
      }
      translateError(err, "Delete customer");
    }
    step("deleted the customer from the local database and queued the deletion for the server, in one transaction");

    const outcome = await attemptDeletion("customer", id);
    const sent = Boolean(outcome?.ok);
    step(sent ? "the server deleted the customer" : `the server could not be told (${outcome && !outcome.ok ? outcome.reason : "nothing queued"}); the deletion is retried by the sync`);
    return { status: "deleted", id, name: customer.name, sentToServer: sent, ...(sent || !outcome || outcome.ok ? {} : { reason: outcome.reason }), steps };
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
