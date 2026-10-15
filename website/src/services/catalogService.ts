import { API_ORIGIN } from '../config/apiOrigin';
import type { CatalogTaxonomy } from '../types/catalog';

export interface CatalogService {
  /** Backed by `GET /api/catalog`. */
  getCategoriesAndBrands(): Promise<CatalogTaxonomy>;
}

export const apiCatalogService: CatalogService = {
  async getCategoriesAndBrands() {
    const res = await fetch(`${API_ORIGIN}/api/catalog`);
    if (!res.ok) throw new Error('Failed to load categories and brands');
    return res.json();
  },
};
