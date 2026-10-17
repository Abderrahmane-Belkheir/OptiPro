import type { Accessory } from '../types/accessory';
import type { Frame } from '../types/frame';

/**
 * Items this browser session has already loaded, by id — filled by the list hooks (useFrames,
 * useAccessories) and by single-item fetches, and read first by useFrame/useAccessory. Opening an
 * item from the grid therefore never refetches what the grid just showed; only a link opened
 * directly (or a refresh), before any list containing the item was loaded, hits `/api/.../:id`.
 * Entries are stored with their asset URLs already resolved.
 */
export const frameCache = new Map<string, Frame>();
export const accessoryCache = new Map<string, Accessory>();

/**
 * Shares one in-flight request per id, so two callers asking for the same item at the same time
 * (e.g. StrictMode's double effect in dev) make a single network request between them.
 */
export function dedupeById<T>(fetchOne: (id: string) => Promise<T>): (id: string) => Promise<T> {
  const inFlight = new Map<string, Promise<T>>();
  return (id) => {
    const existing = inFlight.get(id);
    if (existing) return existing;
    const request = fetchOne(id).finally(() => inFlight.delete(id));
    inFlight.set(id, request);
    return request;
  };
}
