/** Retrying Google's rate-limit refusals inside one call (SCRUM-364).
 *
 * Google refuses a request when one user has too many in flight ("Too many
 * concurrent requests for user") or has used a short quota window. The same
 * request, sent a moment later, is served. Clients that fan out hit this,
 * bracketed by successes either side, and until now
 * each one surfaced as a failed tool call the caller had to repeat.
 *
 * WHAT IS RETRIED, AND WHY ONLY THIS. A refusal for rate is an answer from
 * Google that says the request did not run, so repeating it cannot hide an
 * outage: the path to Google worked. Gateway and proxy failures (502, 503,
 * 504, a dropped connection) are still never retried here; they keep the
 * transient hint and go back to the caller, because a retry that papers over
 * those is how a broken integration looks healthy. Every retry is logged, so
 * a tenant living on retries is visible.
 *
 * READS ONLY. A request is retried when its method is GET. A refused write
 * very likely did not run either, but nothing observed so far is a refused
 * write, a message sent twice costs far more than an error the caller can
 * act on, and an upload's body is a stream that cannot be sent again. Writes
 * surface the refusal at once, with the same hint as before.
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

interface GoogleErrorBody {
  error?: {
    status?: string;
    errors?: Array<{ reason?: string }>;
    details?: Array<{ reason?: string }>;
  };
}

/** Every reason an error body gives, from both of Google's error formats. */
function reasons(bodyText: string): string[] {
  try {
    const e = (JSON.parse(bodyText) as GoogleErrorBody)?.error;
    if (!e || typeof e !== "object") return [];
    return [...(e.errors ?? []), ...(e.details ?? [])]
      .map((x) => x?.reason)
      .concat(e.status)
      .filter((r): r is string => typeof r === "string");
  } catch {
    return [];
  }
}

const RATE_REASONS: ReadonlySet<string> = new Set(["rateLimitExceeded", "userRateLimitExceeded", "RATE_LIMIT_EXCEEDED"]);
/** Limits that reset on a calendar, not in seconds. */
const DAILY_REASONS: ReadonlySet<string> = new Set(["dailyLimitExceeded", "quotaExceeded"]);

/** Is this answer a refusal for rate that a short wait can clear?
 *
 * 403 is Google's status for a dozen unrelated refusals, so there it takes a
 * rate reason. 429 means nothing else, so there the status is enough unless
 * the body names a daily limit. */
export function isRateLimited(status: number, bodyText: string): boolean {
  if (status !== 429 && status !== 403) return false;
  const given = reasons(bodyText);
  if (given.some((r) => DAILY_REASONS.has(r))) return false;
  return status === 429 || given.some((r) => RATE_REASONS.has(r));
}

/** The one date form HTTP still sends: `Fri, 02 Oct 2026 12:00:02 GMT`. */
const HTTP_DATE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/** Retry-After in milliseconds: whole delta-seconds, or an HTTP date still
 * ahead of now. Undefined for anything else, so the caller falls back to its
 * own jittered backoff.
 *
 * The date form is matched before it is parsed. `Date.parse` reads far more
 * than HTTP dates: "1.5" and "-5" both parse, to dates in 2001, and a value
 * read that way came out as a wait of zero, which is a retry with no backoff
 * and no jitter. A real date already in the past is treated the same way: it
 * asks for no wait, and no wait is the one answer backoff exists to avoid. */
function retryAfterMs(header: string | null, now: number): number | undefined {
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
 * Google's own Retry-After wins when it sends one. If that is longer than
 * this call has left to add, there is no retry at all: waiting less than
 * asked would only earn the same refusal. Otherwise the wait is drawn
 * uniformly from zero to a ceiling that doubles per attempt (full jitter),
 * so callers refused together do not come back together. */
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
