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

  it("serves no authentication tool: the gateway connects accounts, this server holds no login", () => {
    // `gws_auth_setup` drove a desktop login that no longer exists, then
    // answered only that the gateway handles authentication. It is removed
    // (SCRUM-412). A tool by that name coming back would offer a login this
    // server cannot perform.
    expect(allTools.filter((t) => /auth/i.test(t.name)).map((t) => t.name)).toEqual([]);
    expect(allTools).toHaveLength(67);
    expect(new Set(allTools.map((t) => t.name)).size).toBe(67);
  });
});
