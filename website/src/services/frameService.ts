import { API_ORIGIN } from '../config/apiOrigin';
import type { Frame } from '../types/frame';

export interface FrameService {
  /** Backed by `GET /api/frames?brandId=&categoryId=`. */
  getFrames(params: { categoryId: number; brandId: string }): Promise<Frame[]>;
  /** Backed by `GET /api/frames/:code` (a frame is known by its code). Resolves to `null` (not an error) when the frame isn't found. */
  getFrameByCode(code: string): Promise<Frame | null>;
}

export const apiFrameService: FrameService = {
  async getFrames({ categoryId, brandId }) {
    const query = new URLSearchParams({ brandId: String(brandId), categoryId: String(categoryId) });
    const res = await fetch(`${API_ORIGIN}/api/frames?${query}`);
    if (!res.ok) throw new Error('Failed to load frames');
    return res.json();
  },

  async getFrameByCode(code) {
    const res = await fetch(`${API_ORIGIN}/api/frames/${encodeURIComponent(code)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('Failed to load frame');
    return res.json();
  },
};
