/**
 * The orchestrator's decisions (SCRUM-303), tested where they are pure.
 *
 * `driveRun` itself needs a gateway and a database and is covered by the
 * run-store suite and, when cases exist, by the live baseline. What is
 * tested here is what it DECIDES: which cases a scope selects, and whether a
 * tool gets probed.
 */

import { describe, expect, it } from "vitest";
import { contractSubjectFor, selectCases } from "./execute";
import type { TestCase } from "./types";

const c = (id: string, tier: 1 | 2): TestCase => ({
  id,
  title: id,
  tier,
  covers: ["x"],
  accounts: [],
  run: async () => {},
});

const all = [c("A1", 1), c("A2", 1), c("D15", 2), c("E17", 2)];

describe("selectCases", () => {
  it("takes everything when the scope asks for nothing", () => {
    expect(selectCases({}, all).map((x) => x.id)).toEqual(["A1", "A2", "D15", "E17"]);
  });

  it("takes one tier", () => {
    expect(selectCases({ tier: 1 }, all).map((x) => x.id)).toEqual(["A1", "A2"]);
  });

  it("takes named cases, and ignores a name that is not registered", () => {
    // Silently dropping an unknown id is right here: the run's scope records
    // what was asked for, so a caller can see their typo in the row.
    expect(selectCases({ caseIds: ["D15", "NOPE"] }, all).map((x) => x.id)).toEqual(["D15"]);
  });

  it("prefers case ids over a tier when both are given", () => {
    expect(selectCases({ tier: 1, caseIds: ["E17"] }, all).map((x) => x.id)).toEqual(["E17"]);
  });

  it("returns a copy, so a caller cannot mutate the registry", () => {
    const selected = selectCases({}, all);
    selected.pop();
    expect(all).toHaveLength(4);
  });
});

describe("contractSubjectFor", () => {
  it("treats a known read plugin tool as probeable", () => {
    expect(contractSubjectFor({ name: "gws-mcp__sheets_read", inputSchema: { type: "object" } })).toMatchObject({
      isRead: true,
      registryEnabled: true,
    });
  });

  it("treats a write plugin tool as a write, so it is never called", () => {
    expect(contractSubjectFor({ name: "gws-mcp__gmail_send" }).isRead).toBe(false);
  });

  it("treats a tool nobody has classified as a write, failing closed", () => {
    // The classifier's own default. A tool added to a plugin and not yet
    // classified must not be probed just because nothing said not to.
    expect(contractSubjectFor({ name: "gws-mcp__some_brand_new_tool" }).isRead).toBe(false);
  });

  it("reads a built-in's own declaration rather than the name classifier", () => {
    // Built-ins live outside the registry, so the name-based classifier has
    // no opinion worth trusting about them; the entry declares its approval.
    expect(contractSubjectFor({ name: "echo" }).isRead).toBe(true);
  });

  it("does not report a built-in as missing a registry row", () => {
    // A built-in has no row BY DESIGN. Reporting it as missing one would
    // make every run fail on every built-in.
    expect(contractSubjectFor({ name: "echo" }).registryEnabled).toBe(true);
  });
});
