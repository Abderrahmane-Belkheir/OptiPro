import { listRows } from "./tableApi";
import type { Category } from "./types";

/** Categories are global and read-only: the backend can list them but not create or delete them. */
export const categoryService = {
  list: () => listRows<Category>("categories"),
};
