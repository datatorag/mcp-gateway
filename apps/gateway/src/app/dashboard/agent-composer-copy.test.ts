import { describe, expect, it } from "vitest";
import {
  ALL_COMPOSER_PLACEHOLDERS,
  COMPOSER_PLACEHOLDER_UNCONNECTED,
} from "./agent-composer-copy";

describe("agent composer copy", () => {
  it("calls the surface Agent, not playground", () => {
    // The same rule agent-cap-copy.test.ts already enforces, now covering the
    // other place this copy lives. It is here BECAUSE the rule was pinned once
    // and broken elsewhere: the cap panel was clean while the composer sat
    // saying "try the playground" on the surface being promoted to the front
    // door. A rule is only enforced on the strings a test can actually see.
    for (const line of ALL_COMPOSER_PLACEHOLDERS) {
      expect(line.toLowerCase()).not.toContain("playground");
    }
  });

  it("contains no em-dashes", () => {
    // House rule, and worth a test for the same reason as next door: a fixed
    // token is present or it is not, no judgement required.
    for (const line of ALL_COMPOSER_PLACEHOLDERS) {
      expect(line).not.toContain("—");
      expect(line).not.toContain("&mdash;");
    }
  });

  it("asks an unconnected user for exactly one thing", () => {
    // The empty state directly above already carries the connect controls and
    // the explanation. The placeholder's whole job is a single next step, so it
    // must not grow into a second sentence of instructions.
    expect(COMPOSER_PLACEHOLDER_UNCONNECTED.split(". ").length).toBe(1);
  });

  it("keeps its own rules honest", () => {
    // A pattern guard can go blind. If these assertions ever stop matching a
    // known-bad string, they would pass by failing to look, and clean copy and
    // a broken check would be indistinguishable.
    const bad = "Connect an account to try the playground";
    expect(bad.toLowerCase()).toContain("playground");
    expect("a — b").toContain("—");
  });
});
