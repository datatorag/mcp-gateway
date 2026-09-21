/**
 * Every argument a case passes must exist on the tool it passes it to
 * (SCRUM-303).
 *
 * Written after the same class of mistake landed twice in two batches, both
 * times found by hand. See `case-arguments.ts` for why neither typechecks.
 * The registry is the authority because it is what `tools/list` serves, so
 * this is a claim about what a CALLER can send, not about the plugin source.
 */

import { describe, expect, it } from "vitest";
import { CASES_DIR } from "./registry";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCaseCalls, topLevelKeys, withoutComments, withoutStringLiterals } from "./case-arguments";

describe("the source reader", () => {
  it("does not mistake a query string for object keys", () => {
    // The false positive the first version had: `smaller:1M` inside a Gmail
    // query looks exactly like a key.
    const source = 'ctx.call("gws-mcp__gmail_search", { query: "has:attachment smaller:1M" })';
    const [call] = readCaseCallsFrom(source);
    expect(call).toEqual(["query"]);
  });

  it("ignores nested keys, which belong to a different object", () => {
    expect(topLevelKeys(" a: 1, b: { c: 2 }, d: [{ e: 3 }] ")).toEqual(["a", "b", "d"]);
  });

  it("blanks every kind of string literal", () => {
    expect(withoutStringLiterals('a "x: 1" b \'y: 2\' c `z: 3`')).not.toMatch(/[xyz]: /);
  });
});

/** The reader, applied to a source string rather than a directory. */
function readCaseCallsFrom(source: string): string[][] {
  const blanked = withoutStringLiterals(source);
  const out: string[][] = [];
  for (const match of blanked.matchAll(/ctx\.call\(\s*""\s*,\s*\{/g)) {
    const open = match.index! + match[0].length - 1;
    let depth = 0;
    let end = open;
    for (let i = open; i < blanked.length; i += 1) {
      if (blanked[i] === "{") depth += 1;
      else if (blanked[i] === "}") {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    out.push(topLevelKeys(blanked.slice(open + 1, end)));
  }
  return out;
}

describe("every case call", () => {
  it("names a tool and passes only arguments, which is what makes the registry check meaningful", () => {
    const calls = readCaseCalls(CASES_DIR);
    /* A FLOOR NEAR THE REAL NUMBER. This was 20 against an actual 159, so a
     * reader regression that silently dropped 130 calls would still have
     * passed it. A floor far below the truth is a number that cannot fail. */
    expect(calls.length, "the scanner reads far fewer calls than it should").toBeGreaterThan(120);
    for (const call of calls) {
      expect(call.tool, `${call.file} has a call with no tool name`).not.toBe("");
    }
  });

  it("never passes `account`, which the runner injects by role", () => {
    // Pinned here as well as refused at runtime: a case naming an account is
    // a case choosing whose mailbox to touch.
    for (const call of readCaseCalls(CASES_DIR)) {
      if (call.args) expect(call.args, `${call.file} passes account to ${call.tool}`).not.toContain("account");
    }
  });
});

/**
 * THE HALF THAT CATCHES REAL DEFECTS, against the registry that `tools/list`
 * is served from. It reads the same table a caller's tool list comes from,
 * so it is a claim about what can actually be sent rather than about the
 * plugin source, which can be ahead of the registry (and is, on dev).
 *
 * A tool the registry does not carry is REPORTED AND SKIPPED, not failed:
 * absence is the dev branch's registry drift, a different problem with a
 * different fix, and failing on it here would train people to ignore this.
 */
describe("case arguments against the served registry", () => {
  it("passes no argument the tool does not declare", async () => {
    const { getDb } = await import("@/lib/db");
    const { tools: toolsTable } = await import("@datatorag-mcp/db");
    const rows = await getDb()
      .select({ name: toolsTable.namespacedName, schema: toolsTable.inputSchemaJson })
      .from(toolsTable);
    const schemas = new Map(
      rows.map((r) => [r.name, (r.schema as { properties?: Record<string, unknown> } | null) ?? {}])
    );

    /* PARAMETERS THE PLUGIN HAS AND THIS REGISTRY DOES NOT, named rather
     * than waved through.
     *
     * The registry says what a caller is TOLD, not what the plugin accepts:
     * the gateway forwards arguments, so a parameter the plugin declares
     * works whether or not the registry row mentions it.
     *
     * EMPTY, AND THAT IS THE POINT. It held the three gmail `signature`
     * parameters, which existed on the plugin from SCRUM-278 and SCRUM-291
     * but not on a dev registry frozen at 2026-09-08. The dev branch was
     * reset from prod on 2026-09-20, which brought those rows across, so the
     * debt is paid rather than forgiven, and this set being empty while the
     * cases still pass `signature` is the proof: an entry here is what was
     * hiding the gap, and with none left the schemas must really declare it.
     *
     * Each entry is a debt, not a decision. The test below refuses an entry
     * naming a tool the registry does not have at all, so this cannot become
     * a way to hide a mistyped tool name. */
    const KNOWN_REGISTRY_DRIFT = new Set<string>([]);

    const problems: string[] = [];
    const unregistered = new Set<string>();
    for (const call of readCaseCalls(CASES_DIR)) {
      const schema = schemas.get(call.tool);
      if (!schema) {
        // Built-ins are not in the table, and neither is a tool the dev
        // registry has not been written with.
        if (call.tool.includes("__")) unregistered.add(call.tool);
        continue;
      }
      if (!call.args) continue;
      const declared = new Set(Object.keys(schema.properties ?? {}));
      for (const arg of call.args) {
        if (declared.has(arg)) continue;
        if (KNOWN_REGISTRY_DRIFT.has(`${call.tool}:${arg}`)) continue;
        problems.push(`${call.file}: ${call.tool} has no argument ${arg}`);
      }
    }

    // An allowlist entry for a tool the registry has never heard of would
    // be a typo wearing a waiver.
    for (const entry of KNOWN_REGISTRY_DRIFT) {
      const [tool] = entry.split(":");
      expect(schemas.has(tool), `${tool} is allowlisted but is not in the registry at all`).toBe(true);
    }

    if (unregistered.size > 0) {
      console.warn(`[case-arguments] not in this registry, unchecked: ${[...unregistered].join(", ")}`);
    }
    expect(problems).toEqual([]);
  });
});

/**
 * A case must DECLARE every tool it calls, cleanup included.
 *
 * The runner already checks this at run time, in both directions, and
 * fails the case. This is the same claim made statically, because the run
 * time version only speaks during a real run against real accounts: D9 and
 * D15 both called `docs_delete` in their cleanup without declaring it, and
 * D15 declared a tool it never called, and none of that would have
 * surfaced until somebody triggered a full run and read three confusing
 * failures. Cheap to check here, expensive to discover there.
 */
describe("what a case declares and what it calls", () => {
  it("declares every tool it calls, and calls every tool it declares", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const problems: string[] = [];
    for (const file of readdirSync(CASES_DIR).filter((f) => f.endsWith(".ts") && f !== "index.ts")) {
      const source = readFileSync(join(CASES_DIR, file), "utf8");
      /* EVERY KIND OF COMMENT COMES OUT FIRST, and the second kind was
       * learned the hard way twice.
       *
       * Round one: a `covers` array carried a line comment, comments
       * contain commas, and splitting on commas cut one in half and threw
       * away the real entry after it. Fixed by stripping `//`.
       *
       * Round two: a BLOCK comment inside a `covers` array contained
       * `["UNREAD"]`. The `[^\]]*` below stops at the first `]`, which was
       * the one inside that comment, so the array was truncated, two real
       * entries were lost and `UNREAD` was read as a declared tool. Both
       * times the test blamed the case and the fault was in this reader.
       *
       * A reader that only survives comments nobody writes is not a
       * reader. */
      // THE SAME STRIPPER the scanner uses. Two readers in one subsystem
      // with their own idea of what a comment is is how this went wrong
      // twice; there is one now and both call it.
      const stripped = withoutComments(source);
      const called = new Set([...stripped.matchAll(/ctx\.call\(\s*"([^"]+)"/g)].map((m) => m[1]));
      const block = /covers:\s*\[([^\]]*)\]/.exec(stripped);
      const covers = new Set(
        [...(block?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1])
      );
      for (const tool of called) {
        if (!covers.has(tool)) problems.push(`${file} calls ${tool} without declaring it`);
      }
      for (const tool of covers) {
        if (!called.has(tool)) problems.push(`${file} declares ${tool} but never calls it`);
      }
    }
    expect(problems).toEqual([]);
  });
});

/**
 * NO CASE REACHES THE TRASH WRITE DIRECTLY.
 *
 * `gws_run` gained exactly one permitted write so a mail run can clean up
 * after itself, and the thing that keeps it narrow is not the guard — the
 * guard only knows it is a gmail trash call. What keeps it to THIS RUN'S
 * OWN MAIL is `ctx.trashOwnMessage`, which refuses any message whose
 * subject lacks this case's stamp and the smoke prefix.
 *
 * So a case that assembled the trash call itself would walk straight past
 * that check while passing the guard. That cannot be caught at run time by
 * anything that is not this rule, and it is a fixed token in the source, so
 * it is checked here.
 */
describe("the trash write", () => {
  it("is reached only through ctx.trashOwnMessage, never assembled by a case", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const offenders: string[] = [];
    for (const file of readdirSync(CASES_DIR).filter((f) => f.endsWith(".ts") && f !== "index.ts")) {
      const source = readFileSync(join(CASES_DIR, file), "utf8");
      for (const call of readCaseCalls(CASES_DIR).filter((c) => c.file === file)) {
        if (call.tool.endsWith("gws_run") && call.args?.includes("method")) {
          // A gws_run call in a case is fine; a trash one is not.
          if (/method:\s*"trash"/.test(source)) offenders.push(`${file} assembles a gws_run trash call`);
        }
      }
    }
    expect([...new Set(offenders)]).toEqual([]);
  });
});

/**
 * THE STRIPPER ITSELF, because this reader has been wrong about comments
 * twice and both times the test blamed a case.
 *
 * Length and string-awareness are the two properties `readCaseCalls`
 * depends on, and neither is obvious from reading the function.
 */
/**
 * END TO END, THROUGH THE SCANNER, because the unit tests above all
 * exercise `withoutComments` in isolation and the bug shipped through the
 * seam between it and `readCaseCalls`: a `//` inside a string truncated the
 * line, the call degraded to "arguments unknown", and nothing noticed.
 */
describe("topLevelKeys reads shorthand", () => {
  it("names a shorthand property, which used to be invisible", () => {
    /* A shorthand has no colon and the scan looked for `name:`, so 68 of
     * the 307 argument names in this suite were invisible: 22 per cent,
     * across 52 of the 157 calls that pass a literal, 32 of them
     * `spreadsheet_id`. A shorthand whose variable is named after the
     * WRONG parameter fails exactly like C9's `page_size` and D15's
     * `folder_id`, and could not be seen. */
    expect(topLevelKeys(" spreadsheet_id, range: tab ")).toEqual(["spreadsheet_id", "range"]);
  });

  it("does NOT read a value as a name", () => {
    // The mistake a looser regex makes: `range: tab` would contribute `tab`.
    expect(topLevelKeys(" range: tab, values: rows ")).toEqual(["range", "values"]);
  });

  it("skips a spread and anything that is not a plain name", () => {
    expect(topLevelKeys(" ...rest, a: 1 ")).toEqual(["a"]);
  });

  it("reads only the top level, not a nested object's keys", () => {
    /* The nested object carries its OWN comma, which is what makes this
     * assertion discriminate: without the depth flattening, `c` inside the
     * braces would surface as a top-level name. The first version used
     * `{ b: 1 }` with no inner comma and killed no mutant at all. */
    expect(topLevelKeys(" a: { b: 1, c: 2 }, d: 3 ")).toEqual(["a", "d"]);
  });

  it.each([
    ["a call with three arguments", " a: fn(x, y, z), b: 2 ", ["a", "b"]],
    ["an arrow with three parameters", " a: (x, y, z) => x, b: 2 ", ["a", "b"]],
    ["a constructor with three arguments", " a: new T(x, y, z), b: 2 ", ["a", "b"]],
    ["a spread of a call with commas", " ...merge(a, b, c), d: 1 ", ["d"]],
  ])("does not read an inner argument of %s as a name", (_label, body, expected) => {
    /* Parentheses were not depth-tracked, so the commas inside a call
     * stayed at the top level and its middle argument became a name. It
     * invents a name rather than hiding one, so the registry check would
     * have reported it loudly, but it also made the "a spread is skipped"
     * claim false for any spread carrying a comma. */
    expect(topLevelKeys(body)).toEqual(expected);
  });
});

describe("readCaseCalls survives a string that contains //", () => {
  it("still reads the arguments of a call whose earlier argument is a URL", () => {
    const dir = mkdtempSync(join(tmpdir(), "case-scan-"));
    try {
      writeFileSync(
        join(dir, "probe.ts"),
        'await ctx.call("gws-mcp__x", { url: "https://example.test/a", wrong_arg: 1 });\n'
      );
      const calls = readCaseCalls(dir);
      expect(calls).toHaveLength(1);
      expect(calls[0].args, "a URL argument must not make the call unreadable").toEqual([
        "url",
        "wrong_arg",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * THE BLIND SPOTS, ASSERTED. Each is a shape where the scanner silently
 * reads FEWER arguments than are there, which is the direction that hides a
 * defect rather than inventing one.
 *
 * Every shape the docblock lists has a row here, so closing one is
 * reported by a red test rather than noticed later. Every row was
 * measured before it was written: an earlier draft of the list named a
 * failing shape that worked, blamed the wrong cause for another, and missed
 * the accessor forms entirely.
 *
 * They run through `readCaseCalls` because that is what actually runs.
 * Some of them answer differently when `topLevelKeys` is probed alone, and
 * the three that do have their own assertions in this block, per shape,
 * rather than being summarised.
 */
describe("what the scanner silently misses", () => {
  const argsFor = (body: string): string[] | null => {
    const dir = mkdtempSync(join(tmpdir(), "blind-"));
    try {
      writeFileSync(join(dir, "p.ts"), `await ctx.call("gws-mcp__x", { ${body} });\n`);
      return readCaseCalls(dir)[0]?.args ?? null;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it.each([
    ["a quoted key", `"spreadsheet_id": x, b: 2`, ["b"]],
    ["a numeric key", "1: x, b: 2", ["b"]],
    ["a key containing $, which IS ascii", "$ref: 1, b: 2", ["b"]],
    ["a key that is not ascii", "café: 1, b: 2", ["b"]],
    ["a getter", "get a() { return 1 }, b: 2", ["b"]],
    ["a setter", "set a(v) {}, b: 2", ["b"]],
    ["an async method", "async a() {}, b: 2", ["b"]],
    ["a generator method", "*a() {}, b: 2", ["b"]],
    ["a key between two mixed-quote strings", `a: 'a"b', b: "c'd", e: 3`, ["a", "e"]],
    ["everything after a regex with an unbalanced close paren", "a: /[)]/, b: 2", ["a"]],
    ["everything after a regex with an unbalanced open paren", "a: /[(]/, b: 2", ["a"]],
    ["everything after a regex with an unbalanced brace", "a: /[}]/, b: 2", ["a"]],
    ["everything after a regex with an escaped bracket", "a: /\\[/, b: 2", ["a"]],
    ["everything after a regex with a bracketed close bracket", "a: /[\\]]/, b: 2", ["a"]],
  ])("misses %s", (_label, body, expected) => {
    expect(argsFor(body)).toEqual(expected);
  });

  it.each([
    ["a regex with an unbalanced open brace", "a: /[{]/, b: 2"],
    ["a regex carrying a double quote", `a: /["]x/, b: 2`],
  ])("gives up on the WHOLE call for %s", (_label, body) => {
    /* The worse of the two regex outcomes, and the one the docblock listed
     * nowhere: these break the brace matching outright, so the call reads
     * as "arguments unknown" rather than losing a key. That is the silent
     * unchecked outcome this file exists to prevent, so it is asserted
     * rather than left to be discovered. */
    expect(argsFor(body)).toBeNull();
  });

  it("reads a PLAIN method shorthand, which is why the accessor forms went unnoticed", () => {
    expect(argsFor("a() {}, b: 2")).toEqual(["a", "b"]);
  });

  it.each([
    ["the brace regex", "a: /[{]/, b: 2"],
    ["the quote regex", `a: /["]x/, b: 2`],
  ])("does not return null for %s when topLevelKeys is probed alone", (_label, body) => {
    /* `matchingBrace` lives in `readCaseCalls`, so `topLevelKeys` has no
     * null path: it reports keys where the scanner reports "arguments
     * unknown". That is WHY these are tested through the scanner. */
    expect(topLevelKeys(` ${body} `)).not.toBeNull();
  });

  it.each([
    ["the quote regex, which reads every key alone", `a: /["]x/, b: 2`, ["a", "b"]],
    ["the brace regex, which still drops the rest alone", "a: /[{]/, b: 2", ["a"]],
    ["the mixed-quote shape, whose loss is in the caller's blanking", `a: 'a"b', b: "c'd", e: 3`, ["a", "b", "e"]],
  ])("reads %s", (_label, body, expected) => {
    /* PER SHAPE, because a summary of these was wrong twice. The brace
     * regex does NOT read every key when probed alone; it degrades from
     * "whole call unknown" to dropping the rest. A sentence claiming all
     * three read correctly was the last thing this block got wrong. */
    expect(topLevelKeys(` ${body} `)).toEqual(expected);
  });

  it("reads a SINGLE mixed-quote string correctly, so the limit is two", () => {
    // The docblock first claimed one was enough. It is not, and an
    // unverified example inside a list of limitations is its own kind of
    // wrong.
    expect(argsFor(`a: 'x"y', b: 1`)).toEqual(["a", "b"]);
  });
});

describe("withoutComments", () => {
  it("preserves length, so offsets taken against it stay valid", () => {
    const src = 'a(); // gone\n/* also gone */ b();';
    expect(withoutComments(src)).toHaveLength(src.length);
  });

  it("keeps newlines, so line numbers survive a block comment", () => {
    const src = "a();\n/* one\n   two */\nb();";
    expect(withoutComments(src).split("\n")).toHaveLength(src.split("\n").length);
  });

  it("does NOT treat // inside a string as a comment", () => {
    /* The regression this replaced: a URL argument truncated the line, the
     * call degraded to "arguments unknown", and it was silently unchecked
     * while the trash-write guard skipped it too. */
    const src = 'ctx.call("t", { url: "https://example.test/x", wrong_arg: 1 });';
    const out = withoutComments(src);
    expect(out).toContain("https://example.test/x");
    expect(out).toContain("wrong_arg");
  });

  it("IS CONFUSED by a regex literal carrying an unmatched quote, and that is known", () => {
    /* A LIMITATION, ASSERTED RATHER THAN CLAIMED AWAY. Telling a regex
     * literal from a division needs parser context this scanner does not
     * have, so `/["\']x/` opens a quote that never closes and the comment
     * after it survives.
     *
     * What bounds it is measurement, not hope: over all case files the
     * scanner extracts 159 calls with only 2 unchecked, and both of those
     * are calls whose arguments are not inline literals, which it reports
     * honestly. The `covers` and argument tests compare against the real
     * registry, so a case this actually broke would show up as a tool
     * mismatch rather than as silence.
     *
     * This test exists so the limitation is discovered by reading the
     * suite rather than by debugging a case, and so that anyone who fixes
     * it is told by a red test that they have. */
    const src = 'const r = /["\']x/i; // survives\nconst after = 1;';
    const out = withoutComments(src);
    expect(out).toContain("const after = 1;");
    expect(out, "if this now passes, the scanner learned about regex literals").toContain("survives");
  });

  it("blanks the line when a regex hides an escaped slash pair, which is the OTHER failure", () => {
    /* The direction the first draft of the docblock did not admit. This is
     * content loss rather than over-inclusion, and it is the same class the
     * walker exists to prevent, so it is asserted rather than described. */
    const src = "const r = /\\/\\//g; const after = 1;";
    expect(withoutComments(src)).not.toContain("after");
    expect(withoutComments(src)).toHaveLength(src.length);
  });

  it("still removes both kinds of comment", () => {
    const out = withoutComments('x(); // one\n/* two */ y();');
    expect(out).not.toContain("one");
    expect(out).not.toContain("two");
    expect(out).toContain("x();");
    expect(out).toContain("y();");
  });
});
