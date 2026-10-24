import { useCallback, useEffect, useRef, useState } from 'react';
import { apiOrderTrackingService, TrackingError, type TrackingFailure } from '../services/orderTrackingService';
import type { TrackedOrder } from '../types/trackedOrder';

/** A tracking code: 6 digits, 100000 to 999999. Checked here before anything is sent. */
export const TRACKING_CODE = /^[1-9]\d{5}$/;

/** How long to wait before trying again when the server did not say. */
const DEFAULT_WAIT_SECONDS = 15 * 60;

export type TrackingState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'found'; order: TrackedOrder }
  | { phase: 'error'; failure: TrackingFailure };

export interface OrderTracking {
  state: TrackingState;
  /** When the server has refused this visitor for a while (too many codes that matched nothing): milliseconds left to wait, counting down; 0 when searching is allowed. */
  waitMs: number;
  search(rawCode: string): Promise<void>;
  clear(): void;
}

/**
 * Following an order with its tracking code. The page puts no limit on searches; only the server protects the codes (it refuses an address that keeps trying codes
 * that match nothing), and when it does the page says how long to wait.
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

  const search = useCallback(async (rawCode: string) => {
    const code = rawCode.replace(/\s+/g, '');
    if (!TRACKING_CODE.test(code)) {
      setState({ phase: 'error', failure: 'invalid' });
      return;
    }
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setState({ phase: 'loading' });
    try {
      const order = await apiOrderTrackingService.getOrder(code, controller.signal);
      if (!controller.signal.aborted) setState({ phase: 'found', order });
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
