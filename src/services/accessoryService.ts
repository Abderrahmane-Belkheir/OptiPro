import { deleteRow, upsertRow, upsertRows, listRows } from "./tableApi";
import type { Accessory, NewAccessory } from "./types";

export const accessoryService = {
  list: () => listRows<Accessory>("accessories"),
  upsert: (accessory: NewAccessory) => upsertRow<Accessory, NewAccessory>("accessories", accessory),
  upsertMany: (accessories: NewAccessory[]) => upsertRows<Accessory, NewAccessory>("accessories", accessories),
  remove: (id: string) => deleteRow("accessories", id),
};
