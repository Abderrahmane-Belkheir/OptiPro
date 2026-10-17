import { deleteRow, upsertRow, upsertRows, listRows } from "./tableApi";
import type { Customer, NewCustomer } from "./types";

export const customerService = {
  list: () => listRows<Customer>("customers"),
  upsert: (customer: NewCustomer) => upsertRow<Customer, NewCustomer>("customers", customer),
  upsertMany: (customers: NewCustomer[]) => upsertRows<Customer, NewCustomer>("customers", customers),
  remove: (id: string) => deleteRow("customers", id),
};
