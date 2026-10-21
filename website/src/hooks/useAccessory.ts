import { useEffect, useState } from 'react';
import { apiAccessoryService } from '../services/accessoryService';
import type { Accessory } from '../types/accessory';
import { accessoryCache, dedupeById } from '../utils/itemCache';
import { resolveProductImages } from '../utils/resolveImageUrl';

type FetchStatus = 'idle' | 'loading' | 'notFound' | 'error';

const fetchAccessoryByCode = dedupeById((code: string) => apiAccessoryService.getAccessoryByCode(code));

interface UseAccessoryResult {
  accessory: Accessory | null;
  isLoading: boolean;
  /** True once loading finishes and no accessory was found (distinct from a network/server error). */
  notFound: boolean;
  error: boolean;
}

/**
 * The accessory is read from the shared cache (see utils/itemCache.ts), which the accessories
 * section fills when it loads — so opening one from the grid renders it immediately with no
 * request. Only on a miss (a link opened directly, or a refresh) does it fetch
 * `/api/accessories/:code`, and caches the result.
 */
export function useAccessory(code: string | undefined): UseAccessoryResult {
  const [status, setStatus] = useState<FetchStatus>('idle');

  useEffect(() => {
    if (!code || accessoryCache.has(code)) return;

    let isActive = true;
    setStatus('loading');

    fetchAccessoryByCode(code)
      .then((result) => {
        if (!isActive) return;
        if (!result) {
          setStatus('notFound');
          return;
        }
        accessoryCache.set(code, { ...result, images: resolveProductImages(result) });
        setStatus('idle'); // the accessory itself is derived from the cache below; this just re-renders
      })
      .catch(() => {
        if (isActive) setStatus('error');
      });

    return () => {
      isActive = false;
    };
  }, [code]);

  const accessory = (code ? accessoryCache.get(code) : undefined) ?? null;
  return {
    accessory,
    isLoading: !accessory && status !== 'notFound' && status !== 'error',
    notFound: !accessory && status === 'notFound',
    error: !accessory && status === 'error',
  };
}
