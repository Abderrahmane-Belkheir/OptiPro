import { useEffect, useState } from 'react';
import { apiSiteInfoService } from '../services/siteInfoService';
import type { SiteInfo } from '../types/siteInfo';

interface UseSiteInfoResult {
  siteInfo: SiteInfo | null;
  isLoading: boolean;
  error: boolean;
}

/** Fetches once on mount — the navbar needs the tenant name immediately, so this can't be gated behind scroll-into-view like the other lazy hooks. */
export function useSiteInfo(): UseSiteInfoResult {
  const [siteInfo, setSiteInfo] = useState<SiteInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let isActive = true;
    setIsLoading(true);
    setError(false);

    apiSiteInfoService
      .getSiteInfo()
      .then((result) => {
        if (isActive) setSiteInfo(result);
      })
      .catch(() => {
        if (isActive) setError(true);
      })
      .finally(() => {
        if (isActive) setIsLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, []);

  return { siteInfo, isLoading, error };
}
