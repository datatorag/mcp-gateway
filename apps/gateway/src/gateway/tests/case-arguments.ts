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

/**
 * The source with every string literal blanked, so nothing inside one is
 * mistaken for syntax.
 *
 * A template literal is blanked WHOLE, `${}` expressions included. The
 * comment here used to say the expressions were kept; they are not, and the
 * behaviour is the safer of the two, since an expression can contain a
 * comma or a colon that would read as another argument. Only the
 * description was wrong, which is the kind of thing that is believed for
 * years because it sounds like a design decision.
 */
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
/**
 * Comments blanked, LENGTH PRESERVED, string literals respected.
 *
 * This reader has been wrong about comments twice, and each time the test
 * blamed a case for the reader's mistake: first a line comment inside a
 * `covers` array ate a real entry, then a block comment containing
 * `["UNREAD"]` truncated one at that bracket.
 *
 * Two properties matter and a regex cannot have both.
 *
 * LENGTH. `readCaseCalls` takes offsets against this output and slices the
 * same string, so anything that shortens it puts every later index off by
 * the amount removed. That is not hypothetical: an earlier scanner matched
 * offsets on the raw source and indexed into a blanked copy of a different
 * length, found nothing, and passed against a deliberately broken
 * argument. Comments become spaces, newlines stay newlines, so offsets and
 * line numbers both survive.
 *
 * STRINGS. Stripping `//` without knowing what a string is truncates a
 * line at the slashes in a URL, and the call it belonged to degrades to
 * "arguments unknown", which is unchecked and silent. Walking the source
 * is the only way to tell a comment from two characters inside a literal.
 *
 * WHAT IT STILL CANNOT DO, stated in both directions because the first
 * draft of this note only admitted the harmless one. Telling a regex
 * literal from a division needs parser context this does not have, so:
 *
 *  - a regex carrying an UNMATCHED quote opens a string that never closes,
 *    and everything after it is treated as string content, so comments
 *    there survive and calls there are still read. Over-inclusion.
 *  - a regex containing an escaped slash pair (`\/\/`) reads as a line
 *    comment at the character level, and the rest of that line is BLANKED.
 *    Content loss, which is the same class this walker exists to prevent.
 *
 * Neither shape appears in the corpus, and the bound is measurement rather
 * than argument: the scanner is compared over every case file and reports
 * how many calls it could not read. A case this broke would surface as a
 * tool or argument mismatch rather than as silence.
 */
export function withoutComments(source: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;

  while (i < source.length) {
    const ch = source[i];

    if (quote !== null) {
      out += ch;
      if (ch === "\\") {
        out += source[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") {
        out += " ";
        i += 1;
      }
      continue;
    }

    if (ch === "/" && source[i + 1] === "*") {
      const close = source.indexOf("*/", i + 2);
      const stop = close === -1 ? source.length : close + 2;
      for (let k = i; k < stop; k += 1) out += source[k] === "\n" ? "\n" : " ";
      i = stop;
      continue;
    }

    out += ch;
    i += 1;
  }
  return out;
}


/**
 * The argument names a call passes, INCLUDING SHORTHAND.
 *
 * `{ spreadsheet_id, range: tab }` names two arguments, and only the second
 * used to be seen: the scan looked for `name:` and a shorthand property has
 * no colon.
 *
 * MEASURED, because the first version of this note guessed. Of 307
 * argument names across 159 calls, 68 were shorthand and therefore
 * invisible: 22 per cent of the names, spread over 52 of the 157 calls that
 * pass a literal. Heavily concentrated in `spreadsheet_id`. The guard was
 * reading 78 per cent of what it was pointed at while reporting nothing
 * wrong, which is worse than reading none of it, because it looked like
 * cover.
 *
 * That is precisely the class it exists to catch. C9 passed `page_size`
 * where the tool declares `max_results`, and D15 passed `folder_id` where
 * it is `parent_folder_id`; an unknown parent is ignored, so the file would
 * have landed in the wrong place and the case would have PASSED. A
 * shorthand whose variable happens to be named after the wrong parameter
 * fails the same way and was invisible.
 *
 * Split on the top-level commas rather than matching a pattern: a piece
 * with a colon names its key before it, and a piece without one is a
 * shorthand whose text IS the name. Reading values as names is the mistake
 * a looser regex makes, since `range: tab` would otherwise contribute
 * `tab`.
 *
 * WHAT IT STILL DOES NOT READ. Every entry is an UNDER-inclusion, which is
 * the direction that hides a defect rather than inventing one, and every
 * one below was measured through `readCaseCalls` rather than reasoned
 * about. None appears in the corpus, and `case-arguments.ast.test.ts`
 * keeps it that way: it reads the same files with the TypeScript compiler
 * and fails if this scanner and the compiler ever disagree. An earlier
 * version of this line said the corpus "is checked by an AST walk" when no
 * such check was committed, which turned a true past-tense measurement
 * into a standing guarantee that did not exist.
 *
 * Three of them share one cause: the candidate has to satisfy
 * `/^[A-Za-z_][A-Za-z0-9_]*$/`, and these do not.
 *
 *  - a QUOTED or NUMERIC key (`"spreadsheet_id": x`, `1: x`), since the
 *    literal blanking has emptied the quotes and a digit cannot lead;
 *  - a key containing `$`, or one that is not ASCII at all. `$ref` is
 *    perfectly ordinary ASCII and is still dropped, because the pattern
 *    omits `$`; an earlier version of this note blamed "not plain ASCII",
 *    which named the wrong cause;
 *  - a key written as an ACCESSOR or a modified method: `get a()`,
 *    `set a()`, `async a()` and `*a()` flatten to `get a`, `set a`,
 *    `async a` and `*a`, none of which matches the pattern. (Three are two
 *    words and the fourth is one token with a `*`; an earlier note said
 *    all four were two words.) A plain `a() {}` reads fine, which is why
 *    this went unnoticed.
 *
 * And two from the string and depth handling:
 *
 *  - a key between TWO strings that each carry the other quote
 *    (`a: 'a"b', b: "c'd", e: 3` loses `b`), because the blanking handles
 *    double quotes before single ones and the literals mis-pair across the
 *    middle key. ONE such string is harmless; it takes two, which was
 *    measured after a first draft claimed one was enough;
 *  - a REGEX carrying an unbalanced bracket, brace, parenthesis or quote,
 *    because a regex is not a string to the blanking and its characters
 *    are read as syntax. Measured, this fails in two different ways:
 *
 *      `a: /[)]/`  `a: /[(]/`  `a: /[}]/`  `a: /\[/`  `a: /[\]]/`
 *          drop every key after them, leaving `["a"]`;
 *      `a: /[{]/`  `a: /["]x/`
 *          break the brace matching outright, so the WHOLE call reads as
 *          `args: null`, which is the silent-unchecked outcome this file
 *          exists to prevent.
 *
 *    The paren members are this change's own doing, since depth tracking
 *    counts parens now; the bracket, brace and quote members predate it. A
 *    previous note listed only the paren and said it "drives the depth
 *    negative", which is true of `/[)]/` and backwards for `/[(]/`.
 *
 * PROBED ALONE, `topLevelKeys` ANSWERS DIFFERENTLY for some of these, so
 * the tests go through `readCaseCalls`, which is what actually runs:
 *
 *  - `a: 'a"b', b: "c'd", e: 3` reads every key, because the literal
 *    blanking that loses `b` lives in the caller;
 *  - `a: /["]x/` reads every key, and `a: /[{]/` still drops the keys
 *    after it. Neither returns `null`, because `matchingBrace` lives in
 *    the caller too and `topLevelKeys` has no null path at all.
 *
 * Each of those three is asserted in `case-arguments.test.ts`. Two
 * earlier drafts of this paragraph gave a COUNT of how many shapes differ;
 * both were wrong, and the second was made wrong by widening the regex
 * entry above without re-reading this one. Naming them costs nothing and
 * cannot be off by one.
 */
export function topLevelKeys(objectBody: string): string[] {
  /* PARENTHESES COUNT TOO. Tracking only braces and brackets left the
   * commas inside a call, an arrow or a `new` at the top level, so
   * `a: fn(x, y, z), b: 2` produced `y` as if it were an argument name, and
   * `...merge(a, b, c)` produced `b` despite the spread. That direction is
   * over-inclusion, so it invents a name the registry check reports rather
   * than hiding one, but it also made the "a spread is skipped" claim below
   * false for any spread carrying a top-level comma. */
  let depth = 0;
  let flat = "";
  for (const ch of objectBody) {
    if (ch === "{" || ch === "[" || ch === "(") depth += 1;
    else if (ch === "}" || ch === "]" || ch === ")") depth -= 1;
    else if (depth === 0) flat += ch;
  }

  const names: string[] = [];
  for (const piece of flat.split(",")) {
    const colon = piece.indexOf(":");
    const candidate = (colon === -1 ? piece : piece.slice(0, colon)).trim();
    // A spread, a computed key or anything else that is not a plain name is
    // skipped rather than guessed at.
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(candidate)) names.push(candidate);
  }
  return names;
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
    /* COMMENTS OUT FIRST, so a `ctx.call` written inside one is not read
     * as a call. Offsets stay consistent because every later index is
     * computed against this same string, which is the mistake an earlier
     * version of this scanner made: it matched offsets on the raw source
     * and then indexed into a blanked copy of a different length, so it
     * found nothing and passed against a deliberately broken argument. */
    const src = withoutComments(readFileSync(join(dir, file), "utf8"));
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
            : topLevelKeys(withoutStringLiterals(src.slice(open + 1, end))),
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
