import { SlackApiError, SlackUnreachableError } from "./slack-client.js";

/**
 * What a failed call says about whose failure it was, in the result's `_meta`
 * (SCRUM-154). The gateway meters a refusal of the request and does not meter
 * a failure on our side or the provider's; it decides from this field, never
 * from the words, which are written for a person and change.
 *
 * The plugin states what happened. Which side that puts the failure on is
 * the gateway's rule, in one place (`usage/classify.ts`).
 *
 * The same module lives in each plugin: the plugins share no package.
 */
export const ERROR_META_KEY = "datatorag.com/error";

export type ErrorMeta =
  /** The provider answered with an HTTP error. */
  | { kind: "http"; status: number; reason?: string }
  /** A failure known to pass on a retry: the provider's 5xx or rate refusal,
   * or the path to it. */
  | { kind: "transient"; status?: number }
  /** The request never reached the provider. */
  | { kind: "unreachable" }
  /** The plugin itself failed: a bug, not an answer. */
  | { kind: "crash" }
  /** The plugin refused the request before sending it: a bad argument. */
  | { kind: "refused" }
  /** The gateway asked for a tool this plugin does not serve. */
  | { kind: "unknown_tool" };

/** Slack's error codes for a failure on its side, answered with HTTP 200. */
const SLACK_SIDE = new Set(["internal_error", "fatal_error", "service_unavailable", "request_timeout"]);

/** Thrown by the runtime rather than by our own refusals: a bug. */
const CRASH_TYPES = [TypeError, ReferenceError, RangeError, SyntaxError, EvalError];

export function errorMetaFor(err: unknown): ErrorMeta {
  if (err instanceof SlackApiError) {
    // Slack answers most refusals with HTTP 200 and `ok: false`; the status
    // carried is the HTTP one, the reason Slack's code.
    if (err.status === 429 || err.error === "ratelimited") return { kind: "transient", status: 429 };
    if (err.status >= 500) return { kind: "transient", status: err.status };
    if (SLACK_SIDE.has(err.error)) return { kind: "transient" };
    return { kind: "http", status: err.status, reason: err.error };
  }
  if (err instanceof SlackUnreachableError) return { kind: "unreachable" };
  if (!(err instanceof Error)) return { kind: "crash" };
  if (err.name === "TimeoutError" || err.name === "AbortError") return { kind: "unreachable" };
  // `fetch` rejects with a TypeError that carries the network failure as its cause.
  if (err instanceof TypeError && err.cause !== undefined) return { kind: "unreachable" };
  if (CRASH_TYPES.some((t) => err instanceof t)) return { kind: "crash" };
  return { kind: "refused" };
}

/** The `_meta` a failed result carries. */
export function errorMetaField(meta: ErrorMeta): { [ERROR_META_KEY]: ErrorMeta } {
  return { [ERROR_META_KEY]: meta };
}
