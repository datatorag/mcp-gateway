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
import { readCaseCalls, topLevelKeys, withoutStringLiterals } from "./case-arguments";

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
    expect(calls.length).toBeGreaterThan(20);
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
     * works whether or not the registry row mentions it. The dev branch's
     * registry is frozen at 2026-09-08 (see the registry-drift brief) and
     * the signature switch shipped on 09-18 under SCRUM-278 and 09-19 under
     * SCRUM-291, so these two are real parameters on a stale row.
     *
     * Each entry is a debt, not a decision. Delete it when the registry is
     * written, and the test below refuses an entry naming a tool the
     * registry does not have at all, so this cannot become a way to hide a
     * mistyped tool name. */
    const KNOWN_REGISTRY_DRIFT = new Set([
      "gws-mcp__gmail_send:signature",
      "gws-mcp__gmail_create_draft:signature",
      "gws-mcp__gmail_update_draft:signature",
    ]);

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
      const called = new Set([...source.matchAll(/ctx\.call\(\s*"([^"]+)"/g)].map((m) => m[1]));
      /* COMMENTS COME OUT FIRST. A `covers` array now carries a comment
       * explaining an entry, comments contain commas, and splitting on
       * commas cut one in half and threw away the real entry sitting after
       * it — so the test reported two cases as undeclared when the fault
       * was in the reader. */
      const block = /covers:\s*\[([^\]]*)\]/.exec(source.replace(/\/\/[^\n]*/g, ""));
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
