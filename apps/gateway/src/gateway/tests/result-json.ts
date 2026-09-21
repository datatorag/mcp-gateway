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
