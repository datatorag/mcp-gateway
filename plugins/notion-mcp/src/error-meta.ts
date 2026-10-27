import { NotionApiError, NotionUnreachableError } from "./notion-client.js";

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

/** Thrown by the runtime rather than by our own refusals: a bug. */
const CRASH_TYPES = [TypeError, ReferenceError, RangeError, SyntaxError, EvalError];

export function errorMetaFor(err: unknown): ErrorMeta {
  if (err instanceof NotionApiError) {
    return { kind: "http", status: err.status, ...(err.code ? { reason: err.code } : {}) };
  }
  if (err instanceof NotionUnreachableError) return { kind: "unreachable" };
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
