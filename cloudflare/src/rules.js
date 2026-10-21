// The rules every request is checked against (the same ones the Express backend used).

// A tenant key: plain characters only (it is the upload credential).
export const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

// A frame's or accessory's id (the upload's <code>): 1-100 plain characters, starting with a letter or digit.
export const SAFE_CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

// A photo's id: a UUID the client makes up.
export const IMAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PRODUCT_TYPES = ['frame', 'accessory'];

/** Where a photo lives in the bucket: images/<photo id> (no extension; its type is stored with it). The id is lower-case. */
export const photoKey = (photoId) => `images/${photoId}`;

// Wrong keys are counted per client address; too many in a window and that address is told to wait.
export const MAX_FAILED_ATTEMPTS = 10;
export const FAILURE_WINDOW_MS = 15 * 60 * 1000;

export const maxImageBytes = (env) => Number(env.IMAGE_MAX_BYTES) || 5 * 1024 * 1024;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
/** A request with no host name, or a raw IP address, can never map to a shop. */
export const isIpAddress = (host) => IPV4.test(host) || host.includes(':');

/**
 * What the bytes really are. The Content-Type header and the code's ending come from the client and prove
 * nothing, so the type is read from the file's first bytes. Only formats a browser can draw without running
 * anything are accepted: no SVG (it can carry scripts and would be served from the site's own address).
 */
export function sniffImage(bytes) {
  const at = (i) => bytes[i];
  const text = (from, to) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => at(i) === b)) return { contentType: 'image/png' };
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return { contentType: 'image/jpeg' };
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(text(0, 6))) return { contentType: 'image/gif' };
  if (bytes.length >= 12 && text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return { contentType: 'image/webp' };
  return null;
}
