import { describe, expect, it } from "vitest";
import { allTools } from "./index.js";
import { CREATE, MUTATE, READ } from "./annotations.js";

/** Annotations decide what a user is told before they approve something, so
 * these invariants are about consent, not tidiness. The presets make the
 * shapes hard to get wrong; these assert the shapes are actually what shipped.
 */
describe("tool annotations", () => {
  it("every registered tool has a human-readable title", () => {
    for (const tool of allTools) {
      expect(tool.annotations?.title, `${tool.name} is missing a title`).toBeTruthy();
    }
  });

  it("every tool declares both hints as real booleans", () => {
    // A missing hint is not neutral: under MCP defaults an absent
    // destructiveHint reads as TRUE and an absent readOnlyHint as FALSE, so
    // an unannotated read tool presents as mutating and destructive.
    for (const tool of allTools) {
      expect(
        typeof tool.annotations?.readOnlyHint,
        `${tool.name} readOnlyHint`
      ).toBe("boolean");
      expect(
        typeof tool.annotations?.destructiveHint,
        `${tool.name} destructiveHint`
      ).toBe("boolean");
    }
  });

  it("nothing claims to be read-only and destructive at once", () => {
    // A tool that cannot modify anything cannot destroy anything either.
    const contradictory = allTools
      .filter((t) => t.annotations?.readOnlyHint && t.annotations?.destructiveHint)
      .map((t) => t.name);
    expect(contradictory).toEqual([]);
  });

  it("uses only the three reviewed shapes, so a fourth is a deliberate act", () => {
    const shapes = new Set(
      allTools.map((t) =>
        JSON.stringify([t.annotations.readOnlyHint, t.annotations.destructiveHint])
      )
    );
    const allowed = new Set(
      [READ("x"), CREATE("x"), MUTATE("x")].map((a) =>
        JSON.stringify([a.readOnlyHint, a.destructiveHint])
      )
    );
    expect([...shapes].filter((s) => !allowed.has(s))).toEqual([]);
  });

  it("gws_auth_setup is not read-only: login triggers OAuth and writes credentials", () => {
    const tool = allTools.find((t) => t.name === "gws_auth_setup");
    expect(tool?.annotations?.readOnlyHint).toBe(false);
  });
});
