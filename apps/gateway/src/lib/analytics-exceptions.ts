import { beforeSendInteraction } from "./analytics-masking";

/**
 * What the browser reports to error tracking, and in what shape (SCRUM-407).
 *
 * No imports but the masking rule, so the server's request-error hook and the browser's analytics
 * provider share one definition of "an error message we are willing to send".
 *
 * WHY THIS EXISTS. For as long as the product has run, a crash in the
 * browser was visible only to the person it happened to, and to anyone who
 * later read console lines out of a session recording. A page that failed
 * for every account on one plan went unseen for two weeks that way. With
 * capture on, an uncaught error or an unhandled rejection becomes an event
 * the day it first happens.
 */

/**
 * The SDK's exception capture, stated in full so nothing rides on a default.
 *
 * `capture_console_errors` IS OFF ON PURPOSE, and it is what makes one crash
 * one event. An error caught by one of our own boundaries (the chat's, the
 * dashboard's) is reported by that boundary, with where it was caught. The
 * framework then also writes a caught error to the console. With console
 * capture on, every boundary catch would arrive twice: once from the
 * boundary and once from the console. An error nothing caught is reported to
 * the window instead, where the SDK's own listener picks it up, once.
 */
export const EXCEPTION_CAPTURE = {
  capture_unhandled_errors: true,
  capture_unhandled_rejections: true,
  capture_console_errors: false,
} as const;

/** The longest error message that leaves the page or the server. A message
 * is written by code, but code interpolates: a failed query carries its
 * values, a parser quotes its input. The first few hundred characters name
 * the fault; the rest is where somebody's data would be. */
export const MAX_EXCEPTION_MESSAGE = 300;

/** A message with anything that looks like bound values cut off, and capped. */
export function trimExceptionMessage(message: unknown): string {
  const text = typeof message === "string" ? message : "";
  // A database driver appends the bound values after this word. They are
  // ids and addresses, never part of what went wrong.
  const withoutValues = text.replace(/\s*\bparams:[\s\S]*$/i, "");
  return withoutValues.length > MAX_EXCEPTION_MESSAGE
    ? `${withoutValues.slice(0, MAX_EXCEPTION_MESSAGE - 1)}…`
    : withoutValues;
}

interface ExceptionEntry {
  type?: unknown;
  value?: unknown;
  stacktrace?: { frames?: unknown[] } | null;
}

interface CapturedEvent {
  event?: string;
  properties?: Record<string, unknown>;
}

/** The browser's whole report of an error in a script from another origin:
 * these two words and no stack. There is nothing in it to act on. */
function isOpaqueScriptError(entry: ExceptionEntry | null | undefined): boolean {
  if (!entry) return false;
  const frames = entry.stacktrace?.frames;
  return (
    typeof entry.value === "string" &&
    /^script error\.?$/i.test(entry.value.trim()) &&
    (!Array.isArray(frames) || frames.length === 0)
  );
}

/**
 * The last look at an event before it is sent. Everything that is not an
 * exception passes through untouched. An exception is dropped when it is
 * only the opaque cross-origin report, and otherwise has its messages
 * trimmed. Returning null is how the SDK is told to send nothing.
 */
export function beforeSendException<T extends CapturedEvent | null>(event: T): T | null {
  if (!event || event.event !== "$exception" || !event.properties) return event;
  const list = event.properties.$exception_list;
  if (!Array.isArray(list)) return event;
  const entries = list as ExceptionEntry[];
  if (entries.length > 0 && entries.every(isOpaqueScriptError)) return null;
  return {
    ...event,
    properties: {
      ...event.properties,
      $exception_list: entries.map((entry) =>
        entry ? { ...entry, value: trimExceptionMessage(entry.value) } : entry
      ),
    },
  };
}

/** The one hook the provider installs: every event passes through both
 * filters. What a click event may carry is decided in analytics-masking.ts
 * (SCRUM-414), for live clicks, rage clicks and dead clicks alike. */
export function beforeSendAnalytics<T extends CapturedEvent | null>(event: T): T | null {
  return beforeSendException(beforeSendInteraction(event));
}
