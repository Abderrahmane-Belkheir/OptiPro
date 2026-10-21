// What the website reads: catalog, frames, accessories, site info. Public, no key; the shop is the request's host.
// The answers are the same for every visitor of a shop, so each is kept at Cloudflare's edge for a few seconds
// (CACHE_SECONDS, default 30): most page views never reach the database.

import { decodeCursor, getAccessories, getAccessoryByCode, getCatalog, getFrameByCode, getFrames, getSiteInfo } from './db.js';
import { decodeSegment, json, malformedAddress } from './http.js';

const MAX_LIMIT = 200;

/** The page size asked for (`limit`), within 1..200, or the default (LIST_LIMIT, 200). Answers a number, or null when `limit` is not a whole number. */
function pageSize(env, url) {
  const asked = url.searchParams.get('limit');
  const fallback = Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(env.LIST_LIMIT) || 200)));
  if (asked === null || asked === '') return fallback;
  return /^\d{1,4}$/.test(asked) && Number(asked) >= 1 ? Math.min(MAX_LIMIT, Number(asked)) : null;
}

function pagingOf(env, url) {
  const limit = pageSize(env, url);
  if (limit === null) return { error: json({ error: `"limit" must be a whole number from 1 to ${MAX_LIMIT}.` }, 400) };
  const raw = url.searchParams.get('cursor');
  if (!raw) return { limit, cursor: null };
  const cursor = decodeCursor(raw);
  return cursor ? { limit, cursor } : { error: json({ error: '"cursor" is not one this server gave out.' }, 400) };
}

/** The list headers: how many there are in all, and where the next page starts (absent on the last page). */
const listHeaders = ({ total, next }) => ({ 'X-Total-Count': String(total), ...(next ? { 'X-Next-Cursor': next } : {}) });

/**
 * Answers a read through the edge cache. `compute()` returns the Response; only a 200 is kept.
 * The key includes the host and the query, so one shop's answer is never shown to another.
 */
async function cached(request, env, ctx, host, compute) {
  const cache = globalThis.caches?.default;
  const url = new URL(request.url);
  const key = new Request(`https://reads.cache/${host}${url.pathname}${url.search}`);
  const hit = cache ? await cache.match(key) : undefined;
  const seconds = Math.max(0, Math.floor(Number(env.CACHE_SECONDS ?? 30)));
  // Browsers always ask again (max-age=0); the edge answers for `seconds` (s-maxage).
  const forBrowsers = `public, max-age=0, s-maxage=${seconds}`;
  if (hit) {
    const headers = new Headers(hit.headers);
    headers.set('X-Cache', 'HIT');
    headers.set('Cache-Control', forBrowsers);
    return new Response(hit.body, { status: hit.status, headers });
  }
  const response = await compute();
  if (response.status === 200 && cache) {
    response.headers.set('Cache-Control', forBrowsers);
    response.headers.set('X-Cache', 'MISS');
    if (seconds > 0) {
      const copy = response.clone();
      copy.headers.set('Cache-Control', `public, max-age=${seconds}`); // what the Cache API keeps it for
      ctx.waitUntil(cache.put(key, copy));
    }
  }
  return response;
}

export function catalogRoute(request, env, ctx, sql, host) {
  return cached(request, env, ctx, host, async () => json(await getCatalog(sql, host)));
}

export function infosRoute(request, env, ctx, sql, host) {
  return cached(request, env, ctx, host, async () => {
    const info = await getSiteInfo(sql, host);
    return info ? json(info) : json({ error: `No tenant configured for host "${host}".` }, 404);
  });
}

export function framesRoute(request, env, ctx, sql, host, url) {
  const brandId = url.searchParams.get('brandId');
  const categoryId = url.searchParams.get('categoryId');
  if (!brandId || !categoryId) return json({ error: 'Both "brandId" and "categoryId" query params are required.' }, 400);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(brandId)) return json({ error: '"brandId" must be a brand id.' }, 400);
  if (!/^\d{1,9}$/.test(categoryId)) return json({ error: '"categoryId" must be a whole number.' }, 400);
  const paging = pagingOf(env, url);
  if (paging.error) return paging.error;
  return cached(request, env, ctx, host, async () => {
    const result = await getFrames(sql, { host, brandId, categoryId: Number(categoryId), ...paging });
    return json(result.items, 200, listHeaders(result));
  });
}

export function accessoriesRoute(request, env, ctx, sql, host, url) {
  const paging = pagingOf(env, url);
  if (paging.error) return paging.error;
  return cached(request, env, ctx, host, async () => {
    const result = await getAccessories(sql, { host, ...paging });
    return json(result.items, 200, listHeaders(result));
  });
}

export function frameRoute(request, env, ctx, sql, host, rawCode) {
  const code = decodeSegment(rawCode);
  if (code === null) return malformedAddress();
  return cached(request, env, ctx, host, async () => {
    const frame = await getFrameByCode(sql, host, code);
    return frame ? json(frame) : json({ error: `No frame with the code "${code}" found.` }, 404);
  });
}

export function accessoryRoute(request, env, ctx, sql, host, rawCode) {
  const code = decodeSegment(rawCode);
  if (code === null) return malformedAddress();
  return cached(request, env, ctx, host, async () => {
    const accessory = await getAccessoryByCode(sql, host, code);
    return accessory ? json(accessory) : json({ error: `No accessory with the code "${code}" found.` }, 404);
  });
}

