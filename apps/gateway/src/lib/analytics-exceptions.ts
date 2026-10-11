/**
 * What the browser reports to error tracking, and in what shape (SCRUM-407).
 *
 * No imports, so the server's request-error hook and the browser's analytics
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

/* -------------------------------------------------------------------------- */
/* Dead clicks                                                                 */
/* -------------------------------------------------------------------------- */

/** The events the SDK sends for a click or swipe that changed nothing. */
const DEAD_INTERACTIONS = new Set(["$dead_click", "$dead_swipe"]);

/** Elements whose text is a label we wrote: the same set click autocapture
 * has always reported. Content placed inside one of these still needs
 * `ph-no-capture`, as it does for a live click. */
const CONTROL_TAGS = new Set(["button", "label", "summary", "input", "select", "textarea", "option"]);

/** The tag of the element that was clicked, from whichever form the SDK
 * used: the chain string leads with it, the array's first entry holds it. */
function deadClickTag(properties: Record<string, unknown>): string | null {
  const elements = properties.$elements;
  if (Array.isArray(elements)) {
    const tag = (elements[0] as { tag_name?: unknown } | undefined)?.tag_name;
    if (typeof tag === "string") return tag.toLowerCase();
  }
  const chain = properties.$elements_chain;
  if (typeof chain === "string") {
    const tag = chain.match(/^[a-z][a-z0-9-]*/i)?.[0];
    if (tag) return tag.toLowerCase();
  }
  return null;
}

/**
 * A dead click, with whatever was on screen taken out of it.
 *
 * THE SDK'S DEAD-CLICK CAPTURE IS WIDER THAN ITS CLICK CAPTURE. A live click
 * is only reported for a control (a link, a button, a field). A dead click
 * is reported for ANY element: someone idly clicking a paragraph. And the
 * event carries that element's text, plus the attributes of it and of every
 * ancestor. In this product a paragraph on screen can be a line of
 * somebody's email. So unless the thing clicked is a control, the event
 * keeps WHERE it happened (the page, which the SDK adds itself) and WHAT
 * KIND of element it was, and nothing that was written on it: the text, the
 * element list and the chain string are all removed.
 *
 * Fail closed: an event whose target cannot be worked out is treated as
 * content, not as a control.
 */
export function beforeSendDeadClick<T extends CapturedEvent | null>(event: T): T {
  if (!event || !event.event || !DEAD_INTERACTIONS.has(event.event) || !event.properties) return event;
  const tag = deadClickTag(event.properties);
  if (tag !== null && CONTROL_TAGS.has(tag)) return event;
  const { $el_text: _text, $elements: _elements, $elements_chain: _chain, ...rest } = event.properties;
  return { ...event, properties: { ...rest, dead_click_tag: tag ?? "unknown" } };
}

/** The one hook the provider installs: every event passes through both. */
export function beforeSendAnalytics<T extends CapturedEvent | null>(event: T): T | null {
  return beforeSendException(beforeSendDeadClick(event));
}
