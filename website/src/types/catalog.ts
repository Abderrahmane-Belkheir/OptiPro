import type { Brand } from './brand';
import type { Category } from './category';

/** The taxonomy served by `GET /api/catalog`. */
export interface CatalogTaxonomy {
  categories: Category[];
  brands: Brand[];
}
