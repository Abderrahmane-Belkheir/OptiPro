import { apiError } from './http.js';
import { FAILURE_WINDOW_MS, MAX_FAILED_ATTEMPTS, SAFE_KEY } from './rules.js';

// Wrong keys per client address. This lives in the memory of one running copy of the Worker, so it is a brake,
// not a wall: Cloudflare may run several copies, each counting on its own. For a hard limit add a Cloudflare
// rate-limiting rule on POST/DELETE /api/*.
const failures = new Map(); // client address -> { count, resetAt }

const blockedForMs = (ip, now) => {
  const entry = failures.get(ip);
  if (!entry) return 0;
  if (entry.resetAt <= now) {
    failures.delete(ip);
    return 0;
  }
  return entry.count >= MAX_FAILED_ATTEMPTS ? entry.resetAt - now : 0;
};

const recordFailure = (ip, now) => {
  const entry = failures.get(ip);
  if (!entry || entry.resetAt <= now) {
    if (failures.size > 5000) failures.delete(failures.keys().next().value); // never grow without bound
    failures.set(ip, { count: 1, resetAt: now + FAILURE_WINDOW_MS });
  } else entry.count += 1;
};

export const resetFailures = () => failures.clear(); // for tests

/**
 * Identifies a shop by its tenant key (`Authorization: Bearer <key>`), which must exist in the tenants table
 * (`findTenant`). Answers { tenantKey } on success, or { response } (a 401, or a 429 once an address has sent 10
 * wrong keys within 15 minutes). Failures other than a wrong key never count, and a request with a valid key is never refused because of the address.
 */
export async function authenticate(request, findTenant, now = Date.now()) {
  const ip = request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For') ?? 'unknown';
  const key = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  const tenant = key && SAFE_KEY.test(key) ? await findTenant(key) : null;
  // A valid key is never slowed down: many shops can share one address (one ISP connection), and the wrong keys of one must not block the others.
  if (tenant && tenant.key === key) return { tenantKey: tenant.key };
  const wait = blockedForMs(ip, now);
  if (wait > 0) {
    const seconds = Math.ceil(wait / 1000);
    return {
      response: apiError(429, 'TOO_MANY_ATTEMPTS', `Too many requests with a wrong tenant key from this address. Try again in ${seconds} seconds.`, { retry: 'after-delay', retryAfterSeconds: seconds }, { 'Retry-After': String(seconds) }),
    };
  }
  recordFailure(ip, now);
  return { response: apiError(401, 'UNAUTHORIZED', 'A valid tenant key is required: send it as "Authorization: Bearer <tenant key>".', {}, { 'WWW-Authenticate': 'Bearer' }) };
}
