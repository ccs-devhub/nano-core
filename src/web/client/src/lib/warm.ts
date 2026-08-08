/**
 * Ported from kyo-web-online's use-warm-modal.js: hover/focus
 * prediction-preload with module-scoped dedupe — once a URL or a
 * request has been warmed it never fetches twice, across components
 * and re-mounts.
 */
const WARMED_IMAGES = new Set<string>();
/* Hold strong refs to every Image() we create. Without this the GC
   eventually reclaims them and the browser may evict the decoded
   bitmap, forcing a re-fetch on the next mount even when HTTP cache
   headers are correct. */
const RETAINED_IMAGES: HTMLImageElement[] = [];

/**
 * Retain a URL the browser has already fetched (or is about to).
 * The held Image() pins the decoded bitmap for the page session, so
 * subsequent <img src=same-url> mounts skip the network round-trip
 * AND the decode step. Deduped.
 */
export function retainImageUrl(url: string | null): void {
  if (typeof Image === 'undefined') {
    return;
  }

  if (!url || WARMED_IMAGES.has(url)) {
    return;
  }

  WARMED_IMAGES.add(url);

  const IMG = new Image();

  IMG.decoding = 'async';
  IMG.src = url;
  RETAINED_IMAGES.push(IMG);
}

interface WarmEntry {
  at: number;
  promise: Promise<unknown>;
}

const REQUEST_CACHE = new Map<string, WarmEntry>();
const DEFAULT_TTL_MS = 60000;

/**
 * TTL request cache with in-flight dedupe: a hover-warm and the
 * click that follows share ONE request; repeat visits inside the
 * TTL reuse the resolved value.
 */
export function warmFetch<T>(
  key: string,
  loader: () => Promise<T>,
  ttl_ms: number = DEFAULT_TTL_MS
): Promise<T> {
  const HIT = REQUEST_CACHE.get(key);

  if (HIT && Date.now() - HIT.at < ttl_ms) {
    return HIT.promise as Promise<T>;
  }

  const PROMISE = loader().catch((error: unknown): never => {
    REQUEST_CACHE.delete(key);
    throw error;
  });

  REQUEST_CACHE.set(key, { at: Date.now(), promise: PROMISE });
  return PROMISE;
}

/** Drop every cached request whose key starts with the prefix. */
export function invalidateWarm(prefix: string): void {
  for (const KEY of [...REQUEST_CACHE.keys()]) {
    if (KEY.startsWith(prefix)) {
      REQUEST_CACHE.delete(KEY);
    }
  }
}

/** Test hook: clear the whole request cache. */
export function resetWarmCache(): void {
  REQUEST_CACHE.clear();
}
