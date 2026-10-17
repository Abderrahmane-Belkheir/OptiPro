import { API_ORIGIN } from '../config/apiOrigin';
import type { Frame } from '../types/frame';

export interface FrameService {
  /** Backed by `GET /api/frames?brandId=&categoryId=`. */
  getFrames(params: { categoryId: number; brandId: number }): Promise<Frame[]>;
  /** Backed by `GET /api/frames/:id`. Resolves to `null` (not an error) when the frame isn't found. */
  getFrameById(id: string): Promise<Frame | null>;
}

export const apiFrameService: FrameService = {
  async getFrames({ categoryId, brandId }) {
    const query = new URLSearchParams({ brandId: String(brandId), categoryId: String(categoryId) });
    const res = await fetch(`${API_ORIGIN}/api/frames?${query}`);
    if (!res.ok) throw new Error('Failed to load frames');
    return res.json();
  },

  async getFrameById(id) {
    const res = await fetch(`${API_ORIGIN}/api/frames/${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('Failed to load frame');
    return res.json();
  },
};
