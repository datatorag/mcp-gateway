/** Retrying Brevo's rate-limit refusals inside one call (SCRUM-468).
 *
 * The rule is notion-mcp's, copied rather than shared because the plugins are
 * separate packages that import nothing from each other. What differs is how
 * Brevo says how long to wait.
 *
 * Brevo's limits are per account and per hour, and low for some endpoints:
 * campaign and account endpoints allow 100 calls an hour below its
 * Professional plan. A refusal (429) carries `x-sib-ratelimit-reset`, the
 * seconds until the window resets, which is usually far longer than one call
 * may wait. So a refusal is retried only for a read, only when the reset is
 * inside this call's budget, and is otherwise answered at once with the wait
 * in words. A write is never retried. Gateway and proxy failures (502, 503,
 * 504, a dropped connection) are never retried either: a retry that papers
 * over those is how a broken integration looks healthy.
 */

/** Requests per call, the first one included. */
export const MAX_ATTEMPTS = 3;
/** The ceiling of the first wait when Brevo names none; it doubles per attempt. */
export const BASE_WAIT_MS = 1_000;
/** The most waiting one call may add, all its retries together. */
export const MAX_ADDED_WAIT_MS = 8_000;

/** The wait and the randomness, in one object so a test can replace them. */
export const retryClock = {
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
  random: (): number => Math.random(),
};

/** Brevo's refusal for rate is 429 and nothing else. */
export function isRateLimited(status: number): boolean {
  return status === 429;
}

/** `x-sib-ratelimit-reset`, or `Retry-After`, as whole seconds to milliseconds.
 * Undefined for anything that is not a plain non-negative integer. */
export function resetMs(header: string | null): number | undefined {
  if (header === null) return undefined;
  const trimmed = header.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) * 1000 : undefined;
}

/** How long to wait before the request after attempt number `attempt`, or
 * null when the call should stop retrying. Brevo's own reset wins when it
 * sends one; longer than the budget left means no retry. Otherwise the wait
 * is drawn from zero to a ceiling that doubles per attempt (full jitter). */
export function retryWaitMs(
  attempt: number,
  reset: string | null,
  waitedMs: number,
  random: () => number = retryClock.random
): number | null {
  const left = MAX_ADDED_WAIT_MS - waitedMs;
  const asked = resetMs(reset);
  if (asked !== undefined) return asked <= left ? asked : null;
  if (left <= 0) return null;
  const ceiling = BASE_WAIT_MS * 2 ** (attempt - 1);
  return Math.min(Math.floor(random() * ceiling), left);
}
