import { useEffect, useRef, useState } from 'react';
import { apiAccessoryService } from '../services/accessoryService';
import type { Accessory } from '../types/accessory';
import { accessoryCache } from '../utils/itemCache';
import { resolveProductImages } from '../utils/resolveImageUrl';

interface UseAccessoriesResult {
  accessories: Accessory[];
  isLoading: boolean;
  /** Whether the load failed. The message shown for this is the caller's responsibility (and locale). */
  error: boolean;
}

/** Only hits the service once `shouldFetch` is true (see AccessoriesSection — fires as the section approaches viewport). */
export function useAccessories(shouldFetch: boolean): UseAccessoriesResult {
  const [accessories, setAccessories] = useState<Accessory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const hasFetchedRef = useRef(false);

  useEffect(() => {
    if (!shouldFetch || hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    let isActive = true;
    setIsLoading(true);
    setError(false);

    apiAccessoryService
      .getAccessories()
      .then((result) => {
        const resolved = result.map((accessory) => ({
          ...accessory,
          images: resolveProductImages(accessory),
        }));
        resolved.forEach((accessory) => accessoryCache.set(accessory.code, accessory));
        if (isActive) setAccessories(resolved);
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
  }, [shouldFetch]);

  return { accessories, isLoading, error };
}
