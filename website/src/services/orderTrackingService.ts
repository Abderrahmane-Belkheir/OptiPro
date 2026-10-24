import { API_ORIGIN } from '../config/apiOrigin';
import type { TrackedOrder } from '../types/trackedOrder';

/** Why a search found nothing, in the words the page needs (it chooses the sentence). */
export type TrackingFailure = 'invalid' | 'not-found' | 'too-many' | 'unavailable' | 'error';

export class TrackingError extends Error {
  readonly failure: TrackingFailure;
  /** With 'too-many': how long the server asks to wait. */
  readonly retryAfterSeconds: number | null;

  constructor(failure: TrackingFailure, retryAfterSeconds: number | null = null) {
    super(failure);
    this.name = 'TrackingError';
    this.failure = failure;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface OrderTrackingService {
  /** Backed by `GET /api/orders/<tracking code>`. Throws a TrackingError. */
  getOrder(code: string, signal?: AbortSignal): Promise<TrackedOrder>;
}

export const apiOrderTrackingService: OrderTrackingService = {
  async getOrder(code, signal) {
    let res: Response;
    try {
      res = await fetch(`${API_ORIGIN}/api/orders/${encodeURIComponent(code)}`, { signal, headers: { Accept: 'application/json' } });
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') throw err;
      throw new TrackingError('error'); // no network, no answer
    }
    if (res.ok) return (await res.json()) as TrackedOrder;

    const body = (await res.json().catch(() => null)) as { code?: string; retryAfterSeconds?: number } | null;
    if (res.status === 404) throw new TrackingError('not-found');
    if (res.status === 400) throw new TrackingError('invalid');
    if (res.status === 403) throw new TrackingError('unavailable');
    if (res.status === 429) {
      const header = Number(res.headers.get('Retry-After'));
      const seconds = Number.isFinite(header) && header > 0 ? header : body?.retryAfterSeconds;
      throw new TrackingError('too-many', typeof seconds === 'number' && seconds > 0 ? seconds : null);
    }
    throw new TrackingError('error');
  },
};
