import { API_ORIGIN } from '../config/apiOrigin';
import type { SiteInfo } from '../types/siteInfo';

export interface SiteInfoService {
  /** Backed by `GET /api/infos`. */
  getSiteInfo(): Promise<SiteInfo>;
}

export const apiSiteInfoService: SiteInfoService = {
  async getSiteInfo() {
    const res = await fetch(`${API_ORIGIN}/api/infos`);
    if (!res.ok) throw new Error('Failed to load site info');
    return res.json();
  },
};
