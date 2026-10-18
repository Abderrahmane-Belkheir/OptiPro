/**
 * What the public API sends as a photo: its CODE, nothing else ("aviator-gold.jpg"), never a path or
 * an address. The website works the address out itself — its own origin + /images/<host name>/<code>
 * (see createImageFileRouter) — so the backend doesn't have to know where the site is served from.
 *
 * Older rows hold a path ("/images/frames/aviator.svg") or even a full address; the code is the last
 * part of whatever is stored, so those keep working too.
 */
export function toImageCode(stored) {
  if (typeof stored !== 'string') return null;
  const withoutQueryOrHash = stored.split(/[?#]/)[0];
  const code = withoutQueryOrHash.split(/[\\/]/).filter(Boolean).pop()?.trim();
  return code || null;
}

/** A photo list as stored in the database -> the list of codes sent to the website (empty entries dropped). */
export function toImageCodes(stored) {
  return (Array.isArray(stored) ? stored : []).map(toImageCode).filter(Boolean);
}
