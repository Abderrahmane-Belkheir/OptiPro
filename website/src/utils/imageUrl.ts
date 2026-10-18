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
