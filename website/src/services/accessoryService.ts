import { API_ORIGIN } from '../config/apiOrigin';
import type { Accessory } from '../types/accessory';

export interface AccessoryService {
  /** Backed by `GET /api/accessories`. */
  getAccessories(): Promise<Accessory[]>;
}

export const apiAccessoryService: AccessoryService = {
  async getAccessories() {
    const res = await fetch(`${API_ORIGIN}/api/accessories`);
    if (!res.ok) throw new Error('Failed to load accessories');
    return res.json();
  },
};
