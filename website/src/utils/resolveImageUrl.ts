import { API_ORIGIN } from '../config/apiOrigin';
import { buildImageUrl } from './imageUrl';

/**
 * A photo's full address from the code the backend sends: the API's origin + /images/<this site's
 * host name>/<code>. See buildImageUrl for the rules.
 */
export function resolveImageUrl(code: string | null | undefined): string | null {
  return buildImageUrl(code, API_ORIGIN, window.location.hostname);
}
