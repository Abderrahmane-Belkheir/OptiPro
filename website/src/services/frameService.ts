import { API_ORIGIN } from '../config/apiOrigin';
import type { Frame } from '../types/frame';

export interface FrameService {
  /** Backed by `GET /api/frames?brandId=&categoryId=`. */
  getFrames(params: { categoryId: number; brandId: number }): Promise<Frame[]>;
}

export const apiFrameService: FrameService = {
  async getFrames({ categoryId, brandId }) {
    const query = new URLSearchParams({ brandId: String(brandId), categoryId: String(categoryId) });
    const res = await fetch(`${API_ORIGIN}/api/frames?${query}`);
    if (!res.ok) throw new Error('Failed to load frames');
    return res.json();
  },
};
