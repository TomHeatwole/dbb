/**
 * Share one in-flight scrape across callers in this function instance, and
 * optionally across instances via cpu_result_cache.
 *
 * The TTL is measured from the moment the scrape *starts*, and callers set it
 * to the same interval the page already polls. The next scheduled poll misses
 * and runs again. A second tab, or a poll that arrives while the first scrape
 * is still running, reuses the snapshot already being built.
 */

import { readFreshCache, writeFreshCache } from './cpuResultCache.mjs';

const slots = new Map();

export function drivesTtlMs(data) {
  return (data?.games ?? []).some((game) => game?.inPlay) ? 8_000 : 60_000;
}

export function sopTtlMs(data) {
  return (data?.games ?? []).some((game) => game?.inPlay) ? 12_000 : 60_000;
}

/** Short enough that a single tab's next poll still reaches the function. */
export function cdnSecondsForMemoryTtl(ttlMs) {
  if (ttlMs <= 12_000) return 4;
  return 15;
}

export function requestIsFresh(req) {
  const raw = req?.query?.fresh;
  if (raw === '1' || raw === 'true' || raw === true) return true;
  try {
    const url = new URL(req?.url || '', 'http://localhost');
    const value = url.searchParams.get('fresh');
    return value === '1' || value === 'true';
  } catch {
    return false;
  }
}

export function setSharedCacheHeaders(res, ttlSec) {
  const sec = Math.max(1, Math.round(ttlSec));
  const value = `public, max-age=0, s-maxage=${sec}`;
  res.setHeader('Cache-Control', value);
  res.setHeader('CDN-Cache-Control', `public, s-maxage=${sec}`);
  res.setHeader('Vercel-CDN-Cache-Control', `public, s-maxage=${sec}`);
}

export function setNoStore(res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
}

function remember(key, data, startedAt, ttl) {
  if (!ttl) {
    slots.delete(key);
    return;
  }
  slots.set(key, { data, startedAt, ttl, inflight: null });
}

export function cachedBook(key, producer, ttlFor, { persist = false } = {}) {
  const now = Date.now();
  const slot = slots.get(key);
  if (slot?.data != null && now - slot.startedAt < slot.ttl) {
    return Promise.resolve(slot.data);
  }
  if (slot?.inflight) return slot.inflight;

  const startedAt = now;
  const inflight = (async () => {
    if (persist) {
      const cached = await readFreshCache(key);
      if (cached?.payload) {
        try {
          const data = JSON.parse(cached.payload);
          const ttl = Math.max(0, Number(cached.ttlMs) || Number(ttlFor(data)) || 0);
          remember(key, data, cached.startedAt || startedAt, ttl);
          return data;
        } catch {
          // Fall through and recompute if a stored payload is unreadable.
        }
      }
    }

    const data = await producer();
    const ttl = Math.max(0, Number(ttlFor(data)) || 0);
    remember(key, data, startedAt, ttl);
    if (persist && ttl > 0) {
      await writeFreshCache(key, JSON.stringify(data), ttl, startedAt);
    }
    return data;
  })().catch((err) => {
    const current = slots.get(key);
    if (current?.inflight === inflight) slots.delete(key);
    throw err;
  });

  slots.set(key, { data: null, startedAt, ttl: 0, inflight });
  return inflight;
}

export async function fillBookCache(key, data, ttlMs, { persist = false, startedAt = Date.now() } = {}) {
  const ttl = Math.max(0, Number(ttlMs) || 0);
  remember(key, data, startedAt, ttl);
  if (persist && ttl > 0) {
    await writeFreshCache(key, JSON.stringify(data), ttl, startedAt);
  }
  return data;
}
