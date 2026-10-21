const ABSOLUTE_URL_PATTERN = /^([a-z][a-z0-9+.-]*:)?\/\//i;

/**
 * The full address of a frame's or accessory's photo, worked out here, not by the backend.
 *
 * The backend sends only the photo's CODE ("aviator-gold.jpg"). The address is
 *
 *     <origin>/images/<host name>/<code>
 *
 * where <origin> is the API's origin (empty when the site is served by the backend itself) and
 * <host name> is the name this site is served from: the backend turns it into the shop and reads the
 * photo from that shop's folder. The shop's private key never appears in an address.
 *
 * Two older forms still work: an absolute address (http(s)://…, or protocol-relative) is returned
 * untouched, which is how the mock catalog's Unsplash photos point at a different host entirely, and
 * a path starting with "/" is resolved against the origin as before.
 */
export function buildImageUrl(code: string | null | undefined, origin: string, hostname: string): string | null {
  if (!code || !code.trim()) return null;
  const value = code.trim();
  if (ABSOLUTE_URL_PATTERN.test(value)) return value;

  const base = origin.replace(/\/+$/, '');
  if (value.startsWith('/')) return `${base}${value}`;
  return `${base}/images/${encodeURIComponent(hostname.toLowerCase())}/${encodeURIComponent(value)}`;
}

/**
 * The address of a photo by its id. By default <origin>/api/images/<id>: the API sends the file. When `photoOrigin` is
 * given (the public address of the photo storage) it is <photoOrigin>/images/<id>: the browser fetches the file from the storage
 * directly and the API is not involved. Uploading and deleting always go through the API.
 */
export function buildPhotoUrl(photoId: string, origin: string, photoOrigin = ''): string {
  const id = encodeURIComponent(photoId.trim());
  const direct = photoOrigin.trim().replace(/\/+$/, '');
  return direct ? `${direct}/images/${id}` : `${origin.replace(/\/+$/, '')}/api/images/${id}`;
}

/**
 * The photo addresses of a frame or an accessory, in the order they are shown (the card shows the first).
 *
 * The backend sends `imageIds`, the ids of the photos the shop uploaded: each one is fetched with
 * GET /api/images/<id>. An item that has none (a record that only carries the older photo `images`
 * codes) still shows those, resolved as before by buildImageUrl.
 */
export function buildProductImageUrls(
  product: { imageIds?: string[] | null; images?: string[] | null },
  origin: string,
  hostname: string,
  photoOrigin = '',
): string[] {
  const ids = (product.imageIds ?? []).filter((id) => typeof id === 'string' && id.trim());
  if (ids.length > 0) return ids.map((id) => buildPhotoUrl(id, origin, photoOrigin));
  return (product.images ?? []).map((code) => buildImageUrl(code, origin, hostname) ?? code);
}
