import type { Database } from "@datatorag-mcp/db";
import { executeUserTool } from "@/gateway/playground/tools";
import { listUserToolRows } from "@/gateway/user-tools";

/**
 * Three things the user could ask for next, naming their own documents.
 *
 * NO MODEL CALL, AND NO RUN SPENT. Two reasons, and the second is the real one.
 * Charging part of someone's allowance for something they did not ask for
 * spends it by our choice rather than theirs. And the moment of recognition
 * this exists to produce does not need a model at all: seeing your own file
 * names come back is the whole effect.
 *
 * THE LOAD-BEARING PROPERTY IS THAT THE SUGGESTIONS NAME REAL FILES. A
 * templated line about "your documents" is worth nothing here; a line naming
 * the deck you were editing yesterday is the entire point. So when the read
 * returns nothing usable this returns an empty list rather than falling back
 * to generic prompts, because a generic suggestion dressed as a personal one
 * is worse than none.
 */

export type AgentSuggestion = {
  /** What the user sees and can click. Also what gets sent as the prompt. */
  text: string;
  /** The item it names, for the caller to key on. */
  fileName: string;
};

/**
 * The read to run, per connector.
 *
 * CHOSEN FROM WHAT THE USER ACTUALLY CONNECTED, not hardcoded to one plugin.
 * An earlier version always searched Drive, which meant a user who connected
 * Atlassian first reached this screen and got nothing — silently, because the
 * no-access path correctly returns an empty list, so there was no error and
 * nothing to notice. Half the connector matrix, quietly unserved, on the one
 * screen built to make the product feel like it already knows something.
 *
 * Ordered: the first entry whose tool the user can actually see is used.
 */
const READS: Array<{ tool: string; args: Record<string, unknown> }> = [
  { tool: "gws-mcp__drive_search", args: { page_size: 6 } },
  {
    tool: "atlassian-mcp__confluence_search",
    args: { cql: "type=page order by lastmodified desc", limit: 6 },
  },
];

/** One phrasing per recognisable kind. The last entry matches anything, so the
 * lookup always resolves. */
const TEMPLATES: Array<{ match: RegExp; phrase: (name: string) => string }> = [
  { match: /\.(sheet|xlsx|csv)$|spreadsheet/i, phrase: (n) => `Summarize the data in "${n}"` },
  { match: /\.(slide|pptx)$|presentation/i, phrase: (n) => `Turn "${n}" into a short summary` },
  { match: /.*/, phrase: (n) => `Summarize "${n}" for me` },
];

function phraseFor(name: string): string {
  // Non-null: the final template's regex matches everything. If that ever
  // stops being true this should fail loudly rather than silently reuse the
  // last entry for names nobody meant it to cover.
  return TEMPLATES.find((t) => t.match.test(name))!.phrase(name);
}

/** Item names out of a search result, whatever envelope it arrived in.
 *
 * Deliberately forgiving: the plugin's response shape is not ours, and a
 * suggestion list is not worth throwing over. Drive calls it `name`, Confluence
 * calls it `title`; anything unrecognised yields no names, which the caller
 * turns into no suggestions.
 */
export function fileNamesFrom(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const envelope = parsed as { files?: unknown; results?: unknown };
  const items = envelope?.files ?? envelope?.results ?? parsed;
  if (!Array.isArray(items)) return [];
  return items
    .map((f) => {
      const item = f as { name?: unknown; title?: unknown };
      return typeof item?.name === "string" ? item.name : item?.title;
    })
    .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
    .map((n) => n.trim());
}

/**
 * Read the user's most recent items and phrase three actions over them.
 *
 * Never throws: this runs right after a connect, on a screen whose job is to
 * make the product feel like it already knows something. A failure here means
 * no suggestions, not a broken page.
 */
export async function buildSuggestions(
  db: Database,
  userId: string,
  limit = 3
): Promise<AgentSuggestion[]> {
  let read: (typeof READS)[number] | undefined;
  try {
    // The shared "what can this user see" policy decides, rather than a guess
    // about what they connected.
    const visible = new Set((await listUserToolRows(db, userId)).map((r) => r.namespacedName));
    read = READS.find((candidate) => visible.has(candidate.tool));
  } catch {
    return [];
  }
  if (!read) return [];

  let result: { text: string; isError: boolean };
  try {
    result = await executeUserTool(db, userId, read.tool, read.args);
  } catch {
    return [];
  }
  if (result.isError) return [];

  const seen = new Set<string>();
  const suggestions: AgentSuggestion[] = [];
  for (const fileName of fileNamesFrom(result.text)) {
    if (seen.has(fileName)) continue;
    seen.add(fileName);
    suggestions.push({ text: phraseFor(fileName), fileName });
    if (suggestions.length === limit) break;
  }
  return suggestions;
}
