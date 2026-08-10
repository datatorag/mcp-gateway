import type { Database } from "@datatorag-mcp/db";
import { executeUserTool } from "@/gateway/playground/tools";

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
  /** The file it names, for the caller to key on. */
  fileName: string;
};

/** One suggestion shape per file kind we can recognise. Adding a kind is one
 * entry; the phrasing stays in one place rather than being interpolated at
 * three call sites. */
const TEMPLATES: Array<{ match: RegExp; phrase: (name: string) => string }> = [
  { match: /\.(sheet|xlsx|csv)$|spreadsheet/i, phrase: (n) => `Summarize the data in "${n}"` },
  { match: /\.(slide|pptx)$|presentation/i, phrase: (n) => `Turn "${n}" into a short summary` },
  { match: /.*/, phrase: (n) => `Summarize "${n}" for me` },
];

function phraseFor(name: string): string {
  const template = TEMPLATES.find((t) => t.match.test(name)) ?? TEMPLATES[TEMPLATES.length - 1];
  return template.phrase(name);
}

/** File names out of a Drive search result, whatever envelope it arrived in.
 *
 * Deliberately forgiving: the plugin's response shape is not ours, and a
 * suggestion list is not worth throwing over. Anything unrecognised yields no
 * names, which the caller turns into no suggestions.
 */
export function fileNamesFrom(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const files = (parsed as { files?: unknown })?.files ?? parsed;
  if (!Array.isArray(files)) return [];
  return files
    .map((f) => (f as { name?: unknown })?.name)
    .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
    .map((n) => n.trim());
}

/**
 * Read the user's most recent files and phrase three actions over them.
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
  let result: { text: string; isError: boolean };
  try {
    result = await executeUserTool(db, userId, "gws-mcp__drive_search", {
      page_size: limit * 2,
    });
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
