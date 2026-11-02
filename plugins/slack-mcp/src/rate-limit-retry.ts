/** Retrying Slack's rate-limit refusals inside one call.
 *
 * The rule is gws-mcp's (SCRUM-364) as notion-mcp copied it
 * (`plugins/notion-mcp/src/rate-limit-retry.ts`), copied again rather than
 * shared because the plugins are separate packages that import nothing from
 * each other. What differs is Slack's refusal, below.
 *
 * WHAT IS RETRIED, AND WHY ONLY THIS. Slack refuses for rate with HTTP 429,
 * `{ok: false, error: "ratelimited"}` and a `Retry-After` header in whole
 * seconds. That answer says the request did not run, so repeating it cannot
 * hide an outage. Gateway and proxy failures (502, 503, 504, a dropped
 * connection) are never retried here. Every retry is logged.
 *
 * READS ONLY, AND A READ IS A READ-ONLY TOOL. The decision is the calling
 * tool's `readOnlyHint`, as in notion-mcp, not the Slack method: a write
 * tool's own lookups are not retried either, so a write tool sends at most
 * what it would have sent once. A write is never retried.
 *
 * SHORT WAITS ONLY. A wait longer than this call may add is not taken at all,
 * because waiting less than asked only earns the same refusal; the refusal
 * is returned with the wait in words.
 */

/** Requests per call, the first one included. */
export const MAX_ATTEMPTS = 3;
/** The ceiling of the first wait; it doubles with each further attempt. */
export const BASE_WAIT_MS = 1_000;
/** The most waiting one call may add, all its retries together. */
export const MAX_ADDED_WAIT_MS = 8_000;

/** The wait and the randomness, in one object so a test can replace them. */
export const retryClock = {
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
  random: (): number => Math.random(),
};

/** Is this answer Slack's refusal for rate? HTTP 429, or the `ratelimited`
 * error code Slack puts in the body of that answer. Nothing else is. */
export function isRateLimited(status: number, error?: string): boolean {
  return status === 429 || error === "ratelimited";
}

/** Retry-After in milliseconds: Slack sends whole seconds. Undefined for
 * anything else, so "1.5", "-5" or a date are never read as a wait. */
export function retryAfterMs(header: string | null): number | undefined {
  if (header === null) return undefined;
  const trimmed = header.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) * 1000 : undefined;
}

/** How long to wait before the request after attempt number `attempt`, or
 * null when the call should stop retrying.
 *
 * Slack's own Retry-After wins. If that is longer than this call has left to
 * add, there is no retry. For a header that is absent or unreadable the wait
 * is drawn uniformly from zero to a ceiling that doubles per attempt (full
 * jitter). */
export function retryWaitMs(
  attempt: number,
  retryAfter: string | null,
  waitedMs: number,
  random: () => number = retryClock.random
): number | null {
  const left = MAX_ADDED_WAIT_MS - waitedMs;
  const asked = retryAfterMs(retryAfter);
  if (asked !== undefined) return asked <= left ? asked : null;
  if (left <= 0) return null;
  const ceiling = BASE_WAIT_MS * 2 ** (attempt - 1);
  return Math.min(Math.floor(random() * ceiling), left);
}
