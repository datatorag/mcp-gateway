/**
 * Display names that come from somebody else's system (SCRUM-366).
 *
 * A Notion workspace name is set by whoever administers that workspace, not
 * by our user and not by us, and it reaches model-facing text
 * (`list_connected_accounts`, the ambiguous-account refusal) and the
 * dashboard. The helper below runs where the name is STORED (the Notion
 * connect callback) and again where it is RENDERED to the model
 * (`list_connected_accounts`, `ambiguousAccountMessage`), so a row written
 * another way (before this existed, or through the dashboard's label edit,
 * which stores the user's own text) is cleaned on the way out too.
 *
 * What it does: control characters (C0, C1, line and paragraph separators,
 * which is newlines and tabs included) become a single space, so the value
 * cannot open a new line in a prompt; format characters (bidi overrides and
 * isolates, zero-width characters, the BOM) are dropped, so it cannot read
 * differently from what it is; whitespace is collapsed and trimmed; and the
 * length is capped. It is idempotent.
 *
 * What it does not do: decide what the text means. Callers must still put the
 * result in as a quoted data value (JSON or `JSON.stringify`), never into a
 * sentence that reads as an instruction.
 *
 * The request-side counterpart is `echoName` in skills-catalogue.ts, which
 * reflects a caller's own argument with the same character classes and a
 * shorter cap. Account emails have no equivalent: they come from the
 * provider's verified identity and are rendered inside JSON or quotes.
 */

/** The longest workspace name kept, in characters (code points). Notion's own
 * names are short; anything near this is not a name. */
export const WORKSPACE_NAME_MAX = 100;

const CUT_MARK = "...";

/** Cleaned text, or null when nothing printable is left. */
function cleanUntrustedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ")
    .replace(/\p{Cf}/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (cleaned === "") return null;
  const chars = [...cleaned];
  if (chars.length <= max) return cleaned;
  return chars.slice(0, max - CUT_MARK.length).join("").trimEnd() + CUT_MARK;
}

/** A Notion workspace name, safe to store and to show. */
export function cleanWorkspaceName(value: unknown): string | null {
  return cleanUntrustedText(value, WORKSPACE_NAME_MAX);
}
