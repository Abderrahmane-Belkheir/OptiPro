import { useEffect, useState } from 'react';
import { categoryFallbackImageUrl } from '../data/categoryPresentation';
import { apiCatalogService } from '../services/catalogService';
import type { Brand } from '../types/brand';
import type { Category } from '../types/category';
import { resolveAssetUrl } from '../utils/resolveAssetUrl';

interface UseCatalogResult {
  categories: Category[];
  brands: Brand[];
  isLoading: boolean;
  /** Whether the load failed. The message shown for this is the caller's responsibility (and locale). */
  error: boolean;
}

export function useCatalog(): UseCatalogResult {
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let isActive = true;
    setIsLoading(true);
    setError(false);

    apiCatalogService
      .getCategoriesAndBrands()
      .then((result) => {
        if (!isActive) return;

        const resolvedCategories = result.categories.map((category) => ({
          ...category,
          url: resolveAssetUrl(category.url) ?? categoryFallbackImageUrl,
        }));

        setCategories(resolvedCategories);
        setBrands(result.brands);
      })
      .catch(() => {
        if (isActive) setError(true);
      })
      .finally(() => {
        if (isActive) setIsLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, []);

  return { categories, brands, isLoading, error };
}
