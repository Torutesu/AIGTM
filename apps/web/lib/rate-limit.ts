/**
 * Per-key sliding-window rate limiter (per instance — replicas each
 * enforce their own window). Buckets expire with their window; a sweep
 * keeps the map bounded under key churn.
 */
export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
  maxKeys?: number;
}) {
  const { limit, windowMs } = opts;
  const maxKeys = opts.maxKeys ?? 10_000;
  const buckets = new Map<string, { reset: number; count: number }>();
  return {
    /** true → reject (over limit). */
    limited(key: string, now = Date.now()): boolean {
      const b = buckets.get(key);
      if (!b || now >= b.reset) {
        buckets.set(key, { reset: now + windowMs, count: 1 });
        if (buckets.size > maxKeys) {
          for (const [k, v] of buckets) if (now >= v.reset) buckets.delete(k);
        }
        return false;
      }
      return ++b.count > limit;
    },
    size(): number {
      return buckets.size;
    },
  };
}
