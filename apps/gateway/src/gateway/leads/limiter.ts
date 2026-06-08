import { createRateLimiter } from "@/gateway/usage/rate-limit";

// Public form — per-IP. 3/min and 10/hour run as two independent limiters
// (the existing limiter uses a single window; we use the stricter short window
// as the primary defense and a hourly sweep as a backstop).
export const leadsMinuteLimiter = createRateLimiter({
  limit: 3,
  windowMs: 60_000,
});

export const leadsHourLimiter = createRateLimiter({
  limit: 10,
  windowMs: 60 * 60_000,
});

if (typeof setInterval !== "undefined") {
  setInterval(() => {
    leadsMinuteLimiter.sweep();
    leadsHourLimiter.sweep();
  }, 5 * 60_000).unref?.();
}
