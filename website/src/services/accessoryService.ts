import { API_ORIGIN } from '../config/apiOrigin';
import type { Accessory } from '../types/accessory';

export interface AccessoryService {
  /** Backed by `GET /api/accessories`. */
  getAccessories(): Promise<Accessory[]>;
  /** Backed by `GET /api/accessories/:id`. Resolves to `null` (not an error) when not found. */
  getAccessoryById(id: string): Promise<Accessory | null>;
}

export const apiAccessoryService: AccessoryService = {
  async getAccessories() {
    const res = await fetch(`${API_ORIGIN}/api/accessories`);
    if (!res.ok) throw new Error('Failed to load accessories');
    return res.json();
  },

  async getAccessoryById(id) {
    const res = await fetch(`${API_ORIGIN}/api/accessories/${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('Failed to load accessory');
    return res.json();
  },
};
