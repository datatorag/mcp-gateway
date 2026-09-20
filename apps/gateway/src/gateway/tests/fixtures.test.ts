/**
 * The role and fixture mapping (SCRUM-303).
 *
 * The property that matters most is the ABSENCE one: an unmapped role or key
 * yields null and the case skips. It must never fall back to a default
 * account, because a test that silently runs as the wrong account reports a
 * pass about something nobody checked.
 *
 * Every value here is invented. The real mapping is a config value and is
 * never in this repo.
 */

import { describe, expect, it, vi } from "vitest";
import { parseFixtureMap } from "./fixtures";

const RAW = JSON.stringify({
  accounts: { sender: "Sender@Example.Test", reader: "reader@example.test" },
  users: { nonAdmin: "11111111-2222-4333-8444-555555555555" },
  fixtures: { sheet: "SheetIdOne", scratchTab: "Scratch" },
});

describe("a value that is set", () => {
  const map = parseFixtureMap(RAW);

  it("resolves a mapped role, lowercased so comparisons are stable", () => {
    expect(map.account("sender")).toBe("sender@example.test");
    expect(map.account("reader")).toBe("reader@example.test");
  });

  it("resolves a mapped fixture key and a named user", () => {
    expect(map.fixture("sheet")).toBe("SheetIdOne");
    expect(map.user("nonAdmin")).toBe("11111111-2222-4333-8444-555555555555");
  });

  it("gives null for a role that is not in the value, never a fallback", () => {
    expect(map.account("atlassian")).toBeNull();
    expect(map.account("nonAdmin")).toBeNull();
  });

  it("gives null for an unmapped fixture key", () => {
    expect(map.fixture("folder")).toBeNull();
  });

  it("lists exactly what a case is missing, for its skip reason", () => {
    expect(map.missingFor({ accounts: ["sender", "atlassian"], fixtures: ["sheet", "deck"] })).toEqual([
      "account:atlassian",
      "fixture:deck",
    ]);
  });

  it("lists nothing when a case's needs are all mapped", () => {
    expect(map.missingFor({ accounts: ["reader"], fixtures: ["sheet"] })).toEqual([]);
  });
});

describe("a value that is absent or unusable", () => {
  it.each([
    ["undefined", undefined],
    ["an empty string", ""],
    ["whitespace", "   "],
  ])("%s maps nothing and says so", (_label, raw) => {
    const map = parseFixtureMap(raw as string | undefined);
    expect(map.empty).toBe(true);
    expect(map.account("reader")).toBeNull();
    expect(map.missingFor({ accounts: ["reader"] })).toEqual(["account:reader"]);
  });

  it("does not throw on malformed JSON, because this runs at boot", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const map = parseFixtureMap("{not json");
    expect(map.empty).toBe(true);
    expect(map.account("reader")).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not throw on JSON of the wrong shape", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const map = parseFixtureMap(JSON.stringify({ accounts: "not an object" }));
    expect(map.empty).toBe(true);
    warn.mockRestore();
  });

  it("treats an empty string for one role as unmapped rather than as an address", () => {
    const map = parseFixtureMap(JSON.stringify({ accounts: { reader: "  " } }));
    expect(map.account("reader")).toBeNull();
  });

  it("ignores a key that is not a known role or fixture", () => {
    // A typo in the config must not silently create a new role that a case
    // could then ask for.
    const map = parseFixtureMap(JSON.stringify({ accounts: { raeder: "x@example.test" } }));
    expect(map.account("reader")).toBeNull();
  });
});
