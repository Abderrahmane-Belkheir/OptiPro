import { deleteRow, upsertRow, upsertRows, listRows } from "./tableApi";
import type { Brand, NewBrand } from "./types";

export const brandService = {
  list: () => listRows<Brand>("brands"),
  upsert: (brand: NewBrand) => upsertRow<Brand, NewBrand>("brands", brand),
  upsertMany: (brands: NewBrand[]) => upsertRows<Brand, NewBrand>("brands", brands),
  /** Rejects with a 409 ApiError while any frame still uses the brand. */
  remove: (id: number) => deleteRow("brands", id),
};
