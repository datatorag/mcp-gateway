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
        if (!declared.has(arg)) problems.push(`${call.file}: ${call.tool} has no argument ${arg}`);
      }
    }

    if (unregistered.size > 0) {
      console.warn(`[case-arguments] not in this registry, unchecked: ${[...unregistered].join(", ")}`);
    }
    expect(problems).toEqual([]);
  });
});
