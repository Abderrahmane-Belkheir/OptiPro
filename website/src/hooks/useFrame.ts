import { useEffect, useState } from 'react';
import { apiFrameService } from '../services/frameService';
import type { Frame } from '../types/frame';
import { dedupeById, frameCache } from '../utils/itemCache';
import { resolveProductImages } from '../utils/resolveImageUrl';

type FetchStatus = 'idle' | 'loading' | 'notFound' | 'error';

const fetchFrameByCode = dedupeById((code: string) => apiFrameService.getFrameByCode(code));

interface UseFrameResult {
  frame: Frame | null;
  isLoading: boolean;
  /** True once loading finishes and no frame was found (distinct from a network/server error). */
  notFound: boolean;
  error: boolean;
}

/**
 * The frame is read from the shared cache (see utils/itemCache.ts), which the grid fills when it
 * loads — so opening a frame from the grid renders it immediately with no request. Only on a miss
 * (a link opened directly, or a refresh) does it fetch `/api/frames/:code`, and caches the result.
 */
export function useFrame(code: string | undefined): UseFrameResult {
  const [status, setStatus] = useState<FetchStatus>('idle');

  useEffect(() => {
    if (!code || frameCache.has(code)) return;

    let isActive = true;
    setStatus('loading');

    fetchFrameByCode(code)
      .then((result) => {
        if (!isActive) return;
        if (!result) {
          setStatus('notFound');
          return;
        }
        frameCache.set(code, { ...result, images: resolveProductImages(result) });
        setStatus('idle'); // the frame itself is derived from the cache below; this just re-renders
      })
      .catch(() => {
        if (isActive) setStatus('error');
      });

    return () => {
      isActive = false;
    };
  }, [code]);

  const frame = (code ? frameCache.get(code) : undefined) ?? null;
  return {
    frame,
    isLoading: !frame && status !== 'notFound' && status !== 'error',
    notFound: !frame && status === 'notFound',
    error: !frame && status === 'error',
  };
}
