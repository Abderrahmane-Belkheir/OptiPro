import { sqlitePrisma } from "../lib/sqliteClient";
import { STATIC_CATEGORIES } from "./staticCategories";

/** A category (a fixed number) or a brand (a UUID), as the screens need it: its id and its name. */
export interface CatalogEntry<Id = number | string> {
  id: Id;
  name: string;
}

export interface CategoriesAndBrands {
  categories: CatalogEntry<number>[];
  brands: CatalogEntry<string>[];
}

export const localCatalogService = {
  /**
   * Every category (the fixed ones from the code) and every brand in the local database, in ONE call: each is just `{ id, name }`, in name
   * order. This database belongs to one shop, so nothing is filtered by tenant. The brand `id` is the local id,
   * the one frames refer to with `brandId`.
   */
  async getCategoriesAndBrands(): Promise<CategoriesAndBrands> {
    const brands = await sqlitePrisma.brand.findMany({ select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] });
    const categories = STATIC_CATEGORIES.map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
    return { categories, brands };
  },
};
