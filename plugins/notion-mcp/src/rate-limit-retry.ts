/** Retrying Notion's rate-limit refusals inside one call.
 *
 * The rule is gws-mcp's (SCRUM-364, `plugins/gws-mcp/src/google-api/
 * rate-limit-retry.ts`), copied rather than shared because the two plugins
 * are separate packages that import nothing from each other. What differs is
 * the refusal Notion sends and how a read is recognised, both below.
 *
 * WHAT IS RETRIED, AND WHY ONLY THIS. Notion refuses for rate with 429
 * (`rate_limited`) and sometimes 529. Either is an answer that says the
 * request did not run, so repeating it cannot hide an outage. Gateway and
 * proxy failures (502, 503, 504, a dropped connection) are never retried
 * here: a retry that papers over those is how a broken integration looks
 * healthy. Every retry is logged.
 *
 * READS ONLY, AND A READ IS A READ-ONLY TOOL. gws-mcp decides by HTTP method.
 * Two Notion reads are POSTs (`/v1/search`, `/v1/data_sources/{id}/query`),
 * so here the decision is the calling tool's `readOnlyHint`. A write is never
 * retried: its refusal goes back at once, with Notion's wait in words.
 *
 * SHORT WAITS ONLY. Notion's limit is about three requests a second averaged
 * over a fixed window; when the window is spent it answers with the rest of
 * the window (observed 2026-10-21: 429, `Retry-After: 16`). A wait longer
 * than this call may add is not taken at all, because waiting less than asked
 * only earns the same refusal; the refusal is returned with the wait in words.
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

/** Is this answer Notion's refusal for rate? 429 means nothing else; 529 is
 * Notion's overloaded answer and is treated the same way. Nothing else is. */
export function isRateLimited(status: number): boolean {
  return status === 429 || status === 529;
}

/** The one date form HTTP still sends: `Fri, 02 Oct 2026 12:00:02 GMT`. */
const HTTP_DATE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/** Retry-After in milliseconds: whole delta-seconds, or an HTTP date still
 * ahead of now. Undefined for anything else.
 *
 * The date form is matched before it is parsed. `Date.parse` reads far more
 * than HTTP dates: "1.5" and "-5" both parse, to dates in 2001, and a value
 * read that way comes out as a wait of zero, which is a retry with no
 * backoff. A date already in the past is treated the same way. */
export function retryAfterMs(header: string | null, now: number = Date.now()): number | undefined {
  if (header === null) return undefined;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  if (!HTTP_DATE.test(trimmed)) return undefined;
  const at = Date.parse(trimmed);
  return Number.isNaN(at) || at <= now ? undefined : at - now;
}

/** How long to wait before the request after attempt number `attempt`, or
 * null when the call should stop retrying.
 *
 * Notion's own Retry-After wins when it sends one a reader can trust. If that
 * is longer than this call has left to add, there is no retry. Otherwise, and
 * for a header that is absent or unreadable, the wait is drawn uniformly from
 * zero to a ceiling that doubles per attempt (full jitter). */
export function retryWaitMs(
  attempt: number,
  retryAfter: string | null,
  waitedMs: number,
  random: () => number = retryClock.random,
  now: number = Date.now()
): number | null {
  const left = MAX_ADDED_WAIT_MS - waitedMs;
  const asked = retryAfterMs(retryAfter, now);
  if (asked !== undefined) return asked <= left ? asked : null;
  if (left <= 0) return null;
  const ceiling = BASE_WAIT_MS * 2 ** (attempt - 1);
  return Math.min(Math.floor(random() * ceiling), left);
}
