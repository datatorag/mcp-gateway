/** An error the caller should retry rather than reason about.
 *
 * These arrive as ordinary API errors and read like permanent ones, so a
 * caller — human or model — treats "Proxy failed to connect to upstream
 * server" as a fact about the request and rewrites a call that was correct.
 * Two different sessions hit that same message on one day and both succeeded
 * on an immediate retry. Naming the class is most of the fix. The one thing
 * retried on the caller's behalf is a read Google refused for rate
 * (rate-limit-retry.ts), where the answer itself says the request did not
 * run; a failure of the path to Google is never retried here, because a retry
 * that hides a real outage is how a broken integration looks healthy. */
export class TransientGwsError extends Error {
  readonly retryable = true;
  constructor(message: string) {
    super(`${message}\n\n[transient — this usually succeeds on an immediate retry]`);
    this.name = "TransientGwsError";
  }
}

/** Failures of the path to Google rather than of the request itself.
 * Deliberately narrow: a pattern that also matches a permanent failure would
 * send callers into a retry loop against a wall. */
const TRANSIENT_PATTERNS = [
  /proxy failed to connect to upstream/i,
  /\b(502|503|504)\b/,
  /bad gateway|service unavailable|gateway time-?out/i,
  /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang ?up/i,
  /backendError|rateLimitExceeded|userRateLimitExceeded/,
];

/** Exported for test: the classification is the whole feature, so pinning the
 * constructor without pinning what reaches it would pin nothing. */
export function isTransient(message: string): boolean {
  return TRANSIENT_PATTERNS.some((p) => p.test(message));
}

/** Throw `message` as transient when it looks like one, plain otherwise. */
export function throwGwsError(message: string): never {
  throw isTransient(message) ? new TransientGwsError(message) : new Error(message);
}

/** The message of anything thrown, without every catch site re-deriving it. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
