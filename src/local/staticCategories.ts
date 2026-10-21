import { sqlitePrisma } from "../lib/sqliteClient";
import type { Category } from "../services/types";

/**
 * The categories, fixed in the code. They are the same rows as the remote database's `categories`
 * table (global, read-only), so the app never has to download them.
 */
export const STATIC_CATEGORIES: readonly Readonly<Category>[] = Object.freeze([
  {
    id: 1,
    name: "Optical Frames",
    imageUrl: "https://images.unsplash.com/photo-1645963053605-25f01c33ca02?auto=format&fit=crop&w=960&q=80",
  },
  {
    id: 2,
    name: "Sunglasses",
    imageUrl: "https://images.unsplash.com/photo-1597011769844-a0bb04c59b2f?auto=format&fit=crop&w=960&q=80",
  },
  {
    id: 3,
    name: "Kids",
    imageUrl: "https://images.unsplash.com/photo-1530303053753-ed17bb09f08e?auto=format&fit=crop&w=960&q=80",
  },
].map((c) => Object.freeze(c)));

/**
 * Run at every start. The app reads the categories from STATIC_CATEGORIES, never from the table; the table
 * only has to hold them so `frames.category_id` can point at them. Each is upserted (no delete, so frames
 * are never in the way), which also puts right any row whose name or image was changed.
 */
export async function seedCategories(): Promise<void> {
  await sqlitePrisma.$transaction(
    STATIC_CATEGORIES.map((c) =>
      sqlitePrisma.category.upsert({
        where: { id: c.id },
        create: { id: c.id, name: c.name, imageUrl: c.imageUrl },
        update: { name: c.name, imageUrl: c.imageUrl },
      }),
    ),
  );
}
