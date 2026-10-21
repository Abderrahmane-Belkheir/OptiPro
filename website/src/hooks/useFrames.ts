import { useEffect, useState } from 'react';
import { apiFrameService } from '../services/frameService';
import type { Frame } from '../types/frame';
import { frameCache } from '../utils/itemCache';
import { resolveProductImages } from '../utils/resolveImageUrl';

/** Keyed by `${categoryId}:${brandId}`, so revisiting a combination already seen this session skips the network call. */
const framesCache = new Map<string, Frame[]>();

function resolveFrame(frame: Frame): Frame {
  return {
    ...frame,
    images: resolveProductImages(frame),
  };
}

interface UseFramesResult {
  frames: Frame[];
  isLoading: boolean;
  /** Whether the load failed. The message shown for this is the caller's responsibility (and locale). */
  error: boolean;
}

export function useFrames(categoryId: number | null, brandId: string | null): UseFramesResult {
  const [frames, setFrames] = useState<Frame[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!categoryId || !brandId) {
      setFrames([]);
      setError(false);
      setIsLoading(false);
      return;
    }

    const cacheKey = `${categoryId}:${brandId}`;
    const cached = framesCache.get(cacheKey);
    if (cached) {
      setFrames(cached);
      setError(false);
      setIsLoading(false);
      return;
    }

    let isActive = true;
    setIsLoading(true);
    setError(false);

    apiFrameService
      .getFrames({ categoryId, brandId })
      .then((result) => {
        const resolved = result.map(resolveFrame);
        framesCache.set(cacheKey, resolved);
        resolved.forEach((frame) => frameCache.set(frame.code, frame));
        if (isActive) setFrames(resolved);
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
  }, [categoryId, brandId]);

  return { frames, isLoading, error };
}
