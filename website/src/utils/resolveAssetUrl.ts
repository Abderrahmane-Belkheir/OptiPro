import { API_ORIGIN } from '../config/apiOrigin';

const ABSOLUTE_URL_PATTERN = /^([a-z][a-z0-9+.-]*:)?\/\//i;

/**
 * The backend sends asset paths, not full URLs (e.g. "/categories/optical-frames.jpg") — the
 * client is responsible for resolving them against the API's own origin. Already-absolute URLs
 * (http(s)://, protocol-relative //cdn…) are left untouched, so pointing a record at a different
 * host entirely — as the mock catalog's Unsplash photos do — still works.
 */
export function resolveAssetUrl(path: string | null | undefined): string | null {
  if (!path || !path.trim()) return null;
  if (ABSOLUTE_URL_PATTERN.test(path)) return path;

  const origin = API_ORIGIN.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${origin}${normalizedPath}`;
}
