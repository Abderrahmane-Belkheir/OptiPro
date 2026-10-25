import { useCallback, useEffect, useRef, useState } from 'react';
import { apiOrderTrackingService, TrackingError, type TrackingFailure } from '../services/orderTrackingService';
import type { TrackedOrder } from '../types/trackedOrder';

/** A year of birth: 4 digits, after 1920 and before this year. Checked here before anything is sent. */
export const isYearOfBirth = (year: number) => Number.isInteger(year) && year > 1920 && year < new Date().getFullYear();

/** How long to wait before trying again when the server did not say. */
const DEFAULT_WAIT_SECONDS = 15 * 60;

export type TrackingState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'found'; orders: TrackedOrder[] }
  | { phase: 'error'; failure: TrackingFailure };

export interface OrderTracking {
  state: TrackingState;
  /** When the server has refused this visitor for a while (too many asks that matched nobody): milliseconds left to wait, counting down; 0 when searching is allowed. */
  waitMs: number;
  search(rawName: string, rawYear: string): Promise<void>;
  clear(): void;
}

/**
 * Finding a customer's orders with the full name and the year of birth. The page puts no limit on searches; only the server protects them (it refuses an address that keeps
 * asking for customers that do not exist), and when it does the page says how long to wait.
 */
export function useOrderTracking(): OrderTracking {
  const [state, setState] = useState<TrackingState>({ phase: 'idle' });
  const [serverUntil, setServerUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef<AbortController | null>(null);

  const waitMs = Math.max(0, serverUntil - now);
  useEffect(() => {
    if (waitMs <= 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waitMs > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => inFlight.current?.abort(), []);

  const search = useCallback(async (rawName: string, rawYear: string) => {
    const name = rawName.replace(/\s+/g, ' ').trim();
    const year = /^\d{4}$/.test(rawYear.trim()) ? Number(rawYear.trim()) : NaN;
    if (name.length < 2 || !isYearOfBirth(year)) {
      setState({ phase: 'error', failure: 'invalid' });
      return;
    }
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setState({ phase: 'loading' });
    try {
      const { orders } = await apiOrderTrackingService.findOrders(name, year, controller.signal);
      if (!controller.signal.aborted) setState({ phase: 'found', orders });
    } catch (err) {
      if (controller.signal.aborted || (err as { name?: string })?.name === 'AbortError') return;
      const failure = err instanceof TrackingError ? err.failure : 'error';
      if (err instanceof TrackingError && failure === 'too-many') {
        setNow(Date.now());
        setServerUntil(Date.now() + (err.retryAfterSeconds ?? DEFAULT_WAIT_SECONDS) * 1000);
      }
      setState({ phase: 'error', failure });
    }
  }, []);

  const clear = useCallback(() => {
    inFlight.current?.abort();
    setState({ phase: 'idle' });
  }, []);

  return { state, waitMs, search, clear };
}
