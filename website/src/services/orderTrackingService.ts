import { API_ORIGIN } from '../config/apiOrigin';
import type { CustomerOrders } from '../types/trackedOrder';

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
  /** Backed by `POST /api/orders/lookup`: the orders of the customer with this full name and year of birth. Throws a TrackingError. */
  findOrders(name: string, yearOfBirth: number, signal?: AbortSignal): Promise<CustomerOrders>;
}

export const apiOrderTrackingService: OrderTrackingService = {
  async findOrders(name, yearOfBirth, signal) {
    let res: Response;
    try {
      res = await fetch(`${API_ORIGIN}/api/orders/lookup`, {
        method: 'POST',
        signal,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, yearOfBirth }),
      });
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') throw err;
      throw new TrackingError('error'); // no network, no answer
    }
    if (res.ok) return (await res.json()) as CustomerOrders;

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
