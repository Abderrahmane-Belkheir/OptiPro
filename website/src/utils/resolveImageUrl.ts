import { API_ORIGIN, PHOTO_ORIGIN } from '../config/apiOrigin';
import { buildImageUrl, buildProductImageUrls } from './imageUrl';

/**
 * A photo's full address from the code the backend sends: the API's origin + /images/<this site's
 * host name>/<code>. See buildImageUrl for the rules.
 */
export function resolveImageUrl(code: string | null | undefined): string | null {
  return buildImageUrl(code, API_ORIGIN, window.location.hostname);
}

/**
 * The photo addresses of a frame or accessory as the backend sent it: from its `imageIds`
 * (<API origin>/api/images/<id>, or <PHOTO_ORIGIN>/images/<id> when the photos are served by the storage itself),
 * or from its older `images` codes when it has no ids.
 */
export function resolveProductImages(product: { imageIds?: string[] | null; images?: string[] | null }): string[] {
  return buildProductImageUrls(product, API_ORIGIN, window.location.hostname, PHOTO_ORIGIN);
}
