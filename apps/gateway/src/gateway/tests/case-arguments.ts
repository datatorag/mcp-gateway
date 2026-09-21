import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Every argument name a case passes, read out of the case sources
 * (SCRUM-303).
 *
 * Exists because the same mistake landed twice in two batches and neither
 * time did anything catch it: C9 passed `page_size` to a tool whose
 * parameter is `max_results`, and D15 passed `folder_id` where it is
 * `parent_folder_id`. Both typecheck, because tool arguments are a
 * `Record<string, unknown>` by construction, and both fail at RUN time in a
 * way that reads as a broken connector rather than as a typo. D15's would
 * have been worse than a failure: an unknown parent is ignored, so the file
 * would have landed in My Drive root and the case would have passed while
 * quietly breaking containment.
 *
 * A case body is TypeScript, so this reads the source rather than executing
 * it. String literals are stripped first: a Gmail query like
 * `"has:attachment smaller:1M"` otherwise looks exactly like an object key
 * and produced a false positive on the first version.
 */

/** `args` is null when the call passes a variable rather than an inline
 * object literal: unchecked, and said so rather than guessed. */
export type CaseCall = { file: string; tool: string; args: string[] | null };

/** The source with every string literal blanked, so nothing inside one is
 * mistaken for syntax. Template literals keep their `${}` expressions, which
 * never contain a key. */
export function withoutStringLiterals(source: string): string {
  return source
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
}

/** The TOP-LEVEL keys of one object literal, ignoring anything nested. */
/** Line comments removed. A comment inside an object literal can contain
 * anything, including `subject:`, and a key reader that does not strip them
 * reports a comment as an argument. That is not hypothetical: it flagged a
 * comment explaining that the tool HAS no subject argument. */
export function withoutLineComments(source: string): string {
  return source.replace(/\/\/[^\n]*/g, "");
}

export function topLevelKeys(objectBody: string): string[] {
  let depth = 0;
  let flat = "";
  for (const ch of objectBody) {
    if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") depth -= 1;
    else if (depth === 0) flat += ch;
  }
  return [...flat.matchAll(/(?:^|[\s,])([A-Za-z_][A-Za-z0-9_]*)\s*:/g)].map((m) => m[1]);
}

/**
 * `ctx.call("<tool>", ...)` across every case module in `dir`.
 *
 * THE OFFSETS AND THE TEXT MUST BE THE SAME TEXT. Two earlier versions got
 * this wrong in two different ways, and both produced a check that looked
 * like it worked:
 *
 *  - collecting names and argument bodies in separate passes and pairing
 *    them by index, which misaligned the moment a case passed a variable
 *    instead of a literal, and reported five defects that were not there;
 *  - matching on the raw source and then indexing into a copy with the
 *    string literals blanked out, which is a DIFFERENT LENGTH, so every
 *    offset was wrong and the check silently found nothing at all. It
 *    passed against a deliberately broken argument name, which is the only
 *    reason it was caught.
 *
 * So this walks the source once, tracking whether it is inside a string as
 * it goes. A brace inside a string is not a brace; an offset is only ever
 * used against the text it came from.
 *
 * A call whose arguments are not an inline literal is recorded with `args`
 * null: unchecked, and honestly so, rather than guessed at.
 */
export function readCaseCalls(dir: string): CaseCall[] {
  const calls: CaseCall[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== "index.ts").sort()) {
    const src = readFileSync(join(dir, file), "utf8");
    for (const match of src.matchAll(/ctx\.call\(\s*"([^"]+)"\s*,\s*/g)) {
      const tool = match[1];
      const open = match.index! + match[0].length;
      if (src[open] !== "{") {
        calls.push({ file, tool, args: null });
        continue;
      }
      const end = matchingBrace(src, open);
      calls.push({
        file,
        tool,
        args:
          end === -1
            ? null
            : topLevelKeys(withoutLineComments(withoutStringLiterals(src.slice(open + 1, end)))),
      });
    }
  }
  return calls;
}

/** The index of the `}` closing the `{` at `open`, ignoring braces that sit
 * inside a string or a comment. -1 when the source is unbalanced. */
export function matchingBrace(src: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      if (nl === -1) return -1;
      i = nl;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}
