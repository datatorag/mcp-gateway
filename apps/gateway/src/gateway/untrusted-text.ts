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

/** The longest MCP client name kept. A real one is a product name. */
export const CLIENT_NAME_MAX = 60;

/** An OAuth client's registered name, which the client chose itself (RFC
 * 7591), safe to store and to show (SCRUM-89). */
export function cleanClientName(value: unknown): string | null {
  return cleanUntrustedText(value, CLIENT_NAME_MAX);
}

/** The longest client name stored at registration (SCRUM-373). Longer than
 * `CLIENT_NAME_MAX` because the consent page shows the name whole; the
 * shorter cap is for the signup event and the #leads post. */
export const REGISTERED_CLIENT_NAME_MAX = 100;

/** A `client_name` as `POST /oauth/register` stores it: cleaned of control
 * and format characters and capped, because the consent page shows it. */
export function cleanRegisteredClientName(value: unknown): string | null {
  return cleanUntrustedText(value, REGISTERED_CLIENT_NAME_MAX);
}

/** The longest User-Agent kept on an auth-failure event (SCRUM-464). */
export const USER_AGENT_MAX = 120;

/** A request's User-Agent, which the caller chose, safe to store. */
export function cleanUserAgent(value: unknown): string | null {
  return cleanUntrustedText(value, USER_AGENT_MAX);
}
