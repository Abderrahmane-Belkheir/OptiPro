import { sqlitePrisma } from "../lib/sqliteClient";
import type { Category } from "../services/types";
import { translateError } from "./errors";


/**
 * Categories are global (not per tenant) and read-only, so they are read and stored as a whole —
 * `replaceAll` saves a fresh copy of the list.
 */
export const localCategoryService = {
  list(): Promise<Category[]> {
    return sqlitePrisma.category.findMany({ orderBy: { id: "asc" } });
  },

  get(id: number): Promise<Category | null> {
    return sqlitePrisma.category.findUnique({ where: { id } });
  },

  /** Upserts each category by id, so frames pointing at them stay valid. */
  async replaceAll(categories: Category[]): Promise<Category[]> {
    try {
      await sqlitePrisma.$transaction(
        categories.map((c) =>
          sqlitePrisma.category.upsert({
            where: { id: c.id },
            create: { id: c.id, name: c.name, imageUrl: c.imageUrl },
            update: { name: c.name, imageUrl: c.imageUrl },
          }),
        ),
      );
    } catch (err) {
      translateError(err, "Store categories");
    }
    return localCategoryService.list();
  },
};
