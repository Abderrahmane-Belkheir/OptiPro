import { API_ORIGIN } from '../config/apiOrigin';
import type { Accessory } from '../types/accessory';

export interface AccessoryService {
  /** Backed by `GET /api/accessories`. */
  getAccessories(): Promise<Accessory[]>;
  /** Backed by `GET /api/accessories/:code` (an accessory is known by its code). Resolves to `null` (not an error) when not found. */
  getAccessoryByCode(code: string): Promise<Accessory | null>;
}

export const apiAccessoryService: AccessoryService = {
  async getAccessories() {
    const res = await fetch(`${API_ORIGIN}/api/accessories`);
    if (!res.ok) throw new Error('Failed to load accessories');
    return res.json();
  },

  async getAccessoryByCode(code) {
    const res = await fetch(`${API_ORIGIN}/api/accessories/${encodeURIComponent(code)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('Failed to load accessory');
    return res.json();
  },
};
