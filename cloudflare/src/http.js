// Small helpers shared by every route: JSON answers, the error format, CORS.

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Expose-Headers': 'X-Total-Count, X-Next-Cursor, Retry-After',
};

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...headers } });
}

/**
 * Every failure of an upload, a photo delete or a product delete is answered the same way, so a client can tell what is
 * wrong without parsing sentences:
 *
 *   { "error": "<what happened, in words>", "code": "<STABLE_MACHINE_CODE>", ...details }
 *
 * Details never reuse the names `error` and `code`. Where sending the request again can help, `retry` says how:
 * "new-id", "same-request" or "after-delay" (with `retryAfterSeconds`). This is the format the Electron app reads.
 */
export function apiError(status, code, error, extra = {}, headers = {}) {
  return json({ error, code, ...extra }, status, headers);
}

/** A path segment, percent-decoded; null when it holds an invalid escape (the caller answers 400 MALFORMED_ADDRESS). */
export function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export const malformedAddress = () =>
  apiError(400, 'MALFORMED_ADDRESS', 'The address contains an invalid percent-escape. The code and the photo id are plain characters and need no escaping.');

/** Postgres' SQLSTATE of a failed statement (the Neon driver puts it in `code`), or '' when there is none. */
export const sqlState = (err) => (typeof err?.code === 'string' ? err.code : '');
