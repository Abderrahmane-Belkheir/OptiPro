import type { Category } from "../services/types";
import { STATIC_CATEGORIES } from "./staticCategories";

/** Categories are fixed in the code (STATIC_CATEGORIES): they are read from there and can't be changed. */
export const localCategoryService = {
  async list(): Promise<Category[]> {
    return STATIC_CATEGORIES.map((c) => ({ ...c }));
  },

  async get(id: number): Promise<Category | null> {
    const found = STATIC_CATEGORIES.find((c) => c.id === id);
    return found ? { ...found } : null;
  },
};
