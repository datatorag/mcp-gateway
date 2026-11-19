import type { ToolResult } from "./types";

/**
 * A tool result's text, parsed as JSON (SCRUM-303).
 *
 * Every read case wants the same three steps: join the content parts, refuse
 * an `isError` result with the text the tool actually gave, and parse. Done
 * by hand in each case they drift, and the third step is the one that drifts
 * into `JSON.parse(text)` with no catch, which turns a tool returning prose
 * into an unhandled SyntaxError instead of a case failure that says what
 * came back.
 */
export function resultText(result: ToolResult): string {
  return result.content.map((c) => c.text ?? "").join("");
}

/** The line gws_run leads with when a named tool handles the call
 * (SCRUM-499): the tool's name, then "covers this call:", or for a thread
 * read "reads this thread in one call:". Its wording lives in the plugin's
 * `tools/named-tool-hints.ts`; a change there must change this. */
export const NAMED_TOOL_LINE = /^[a-z][a-z0-9_]* (covers this call|reads this thread in one call): /;

/** The answer without that leading line, so a reader that parses the answer
 * sees the API's own JSON, as it did before the line existed. */
export function answerText(result: ToolResult): string {
  const [first, ...rest] = result.content;
  if (rest.length > 0 && NAMED_TOOL_LINE.test(first?.text ?? "")) return rest.map((c) => c.text ?? "").join("");
  return resultText(result);
}

/** Throws with the tool's own words when it errored or did not answer JSON. */
export function resultJson<T = unknown>(what: string, result: ToolResult): T {
  const text = answerText(result).trim();
  if (result.isError) throw new Error(`${what} answered with an error: ${clip(text)}`);
  if (text === "") throw new Error(`${what} answered with no content at all`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${what} did not answer JSON: ${clip(text)}`);
  }
}

/** Long enough to diagnose, short enough that evidence stays readable. */
function clip(text: string): string {
  return text.length > 300 ? `${text.slice(0, 300)}...` : text;
}

/**
 * The first array under any key, for tools that wrap their rows.
 *
 * Deliberately shape-tolerant: these cases exist to prove a READ PATH is
 * alive, and failing them because a plugin renamed `files` to `items` would
 * report "Drive is broken" about a key name. A case that needs an exact
 * shape asserts it itself.
 */
export function firstArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      if (Array.isArray(v)) return v;
    }
  }
  return null;
}
