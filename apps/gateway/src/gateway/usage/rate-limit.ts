export interface RateLimiterOpts {
  limit: number;
  windowMs: number;
  clock?: () => number;
}

export interface RateLimitResult {
  ok: boolean;
  retryAfterMs: number;
}

export interface RateLimiter {
  check(userId: string): RateLimitResult;
  sweep(): void;
}

export function createRateLimiter(opts: RateLimiterOpts): RateLimiter {
  const clock = opts.clock ?? (() => Date.now());
  const buckets = new Map<string, number[]>();

  function sweep(): void {
    const cutoff = clock() - opts.windowMs;
    for (const [userId, arr] of buckets) {
      const pruned = arr.filter((t) => t > cutoff);
      if (pruned.length === 0) buckets.delete(userId);
      else if (pruned.length !== arr.length) buckets.set(userId, pruned);
    }
  }

  return {
    check(userId: string): RateLimitResult {
      const now = clock();
      const cutoff = now - opts.windowMs;
      const arr = buckets.get(userId) ?? [];
      const pruned = arr.filter((t) => t > cutoff);
      if (pruned.length >= opts.limit) {
        const oldest = pruned[0];
        const retryAfterMs = Math.max(1, oldest + opts.windowMs - now);
        buckets.set(userId, pruned);
        return { ok: false, retryAfterMs };
      }
      pruned.push(now);
      buckets.set(userId, pruned);
      return { ok: true, retryAfterMs: 0 };
    },
    sweep,
  };
}

export const dashboardApiLimiter = createRateLimiter({
  limit: 120,
  windowMs: 60_000,
});

// Evict idle users so the Map doesn't accumulate entries indefinitely.
if (typeof setInterval !== "undefined") {
  setInterval(() => dashboardApiLimiter.sweep(), 5 * 60_000).unref?.();
}
