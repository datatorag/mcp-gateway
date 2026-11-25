import type { ToolResult } from "./types";

/** The line gws_run leads with when a named tool handles the call
 * (SCRUM-499): the tool's name, then "covers this call:", or for a thread
 * read "reads this thread in one call:". Its wording lives in the plugin's
 * `tools/named-tool-hints.ts`; a change there must change this. */
export const NAMED_TOOL_LINE = /^[a-z][a-z0-9_]* (covers this call|reads this thread in one call): /;

/** That leading line, when a successful answer carries one before its
 * payload; undefined otherwise. GM12 reads it here; every other reader gets
 * the payload alone from `resultText`. */
export function namedToolHint(result: ToolResult): string | undefined {
  if (result.isError || result.content.length < 2) return undefined;
  const first = result.content[0]?.text ?? "";
  return NAMED_TOOL_LINE.test(first) ? first : undefined;
}

/**
 * A tool result's text, parsed as JSON (SCRUM-303).
 *
 * Every read case wants the same three steps: join the content parts, refuse
 * an `isError` result with the text the tool actually gave, and parse. Done
 * by hand in each case they drift, and the third step is the one that drifts
 * into `JSON.parse(text)` with no catch, which turns a tool returning prose
 * into an unhandled SyntaxError instead of a case failure that says what
 * came back.
 *
 * The text is the answer's payload: a named-tool line ahead of it is left
 * out, so a reader that parses the text sees the API's own JSON whether or
 * not the line is there.
 */
export function resultText(result: ToolResult): string {
  const parts = namedToolHint(result) === undefined ? result.content : result.content.slice(1);
  return parts.map((c) => c.text ?? "").join("");
}

/** Throws with the tool's own words when it errored or did not answer JSON. */
export function resultJson<T = unknown>(what: string, result: ToolResult): T {
  const text = resultText(result).trim();
  if (result.isError) throw new Error(`${what} answered with an error: ${clip(text)}`);
  if (text === "") throw new Error(`${what} answered with no content at all`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${what} did not answer JSON: ${clip(text)}`);
  }
}

/**
 * The first text block of an answer, alone (SCRUM-511).
 *
 * For a tool whose answer is its first block and whose later blocks are not
 * part of it: PostHog's `exec` follows a result with a notice and a
 * conversation id, each a block of its own, so the joined text is not JSON.
 * Throws with the tool's own words when it errored or answered no text.
 */
export function firstTextBlock(what: string, result: ToolResult): string {
  if (result.isError) throw new Error(`${what} answered with an error: ${clip(resultText(result).trim())}`);
  const first = result.content.find((c) => c.type === "text" && typeof c.text === "string");
  const text = first?.text?.trim() ?? "";
  if (text === "") throw new Error(`${what} answered with no text at all`);
  return text;
}

/** That first block, parsed as a JSON object. */
export function firstBlockJson<T = Record<string, unknown>>(what: string, result: ToolResult): T {
  const text = firstTextBlock(what, result);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${what} did not answer JSON in its first block: ${clip(text)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${what} did not answer a JSON object in its first block: ${clip(text)}`);
  }
  return parsed as T;
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
