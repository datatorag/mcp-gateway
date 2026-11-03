/** Retrying PostHog's refusals for rate inside one call (SCRUM-471).
 *
 * The rule is brevo-mcp's, copied rather than shared because the plugins are
 * separate packages that import nothing from each other. Every PostHog tool
 * is a read, so any of them may be retried, but only once, and only when
 * PostHog's `Retry-After` fits this call's budget; otherwise the refusal is
 * answered at once with the wait in words. Gateway and proxy failures are
 * never retried: a retry that papers over those is how a broken integration
 * looks healthy.
 */

/** Requests per call, the first one included. */
export const MAX_ATTEMPTS = 2;
/** The ceiling of the wait when PostHog names none. */
export const BASE_WAIT_MS = 1_000;
/** The most waiting one call may add. */
export const MAX_ADDED_WAIT_MS = 8_000;

/** The wait and the randomness, in one object so a test can replace them. */
export const retryClock = {
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
  random: (): number => Math.random(),
};

/** How long to wait before the next request, or null when the call should
 * not retry. PostHog's own `Retry-After` wins when it sends one; longer than
 * the budget left means no retry. */
export function retryWaitMs(
  attempt: number,
  retryAfter: string | null,
  waitedMs: number,
  random: () => number = retryClock.random
): number | null {
  const left = MAX_ADDED_WAIT_MS - waitedMs;
  const trimmed = retryAfter?.trim();
  if (trimmed && /^\d+$/.test(trimmed)) {
    const asked = Number(trimmed) * 1000;
    return asked <= left ? asked : null;
  }
  if (left <= 0) return null;
  return Math.min(Math.floor(random() * BASE_WAIT_MS * 2 ** (attempt - 1)), left);
}
