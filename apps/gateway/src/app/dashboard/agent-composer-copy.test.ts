import { describe, expect, it } from "vitest";
import {
  ALL_COMPOSER_PLACEHOLDERS,
  ALL_PANEL_COPY,
  COMPOSER_PLACEHOLDER_AWAITING_CONFIRM,
} from "./agent-composer-copy";

/** Placeholders and panel labels together: the retired-term and em-dash rules
 * apply to every string a user reads on this surface, not just the ones that
 * happened to be extracted first. Splitting them is how the panel heading kept
 * saying the retired word through three passes at retiring it. */
const ALL_USER_FACING = [...ALL_COMPOSER_PLACEHOLDERS, ...ALL_PANEL_COPY];

describe("agent composer copy", () => {
  it("calls the surface Agent, not playground", () => {
    // The same rule agent-cap-copy.test.ts already enforces, now covering the
    // other place this copy lives. It is here BECAUSE the rule was pinned once
    // and broken elsewhere: the cap panel was clean while the composer sat
    // saying "try the playground" on the surface being promoted to the front
    // door. A rule is only enforced on the strings a test can actually see.
    for (const line of ALL_USER_FACING) {
      expect(line.toLowerCase()).not.toContain("playground");
    }
  });

  it("contains no em-dashes", () => {
    // House rule, and worth a test for the same reason as next door: a fixed
    // token is present or it is not, no judgement required.
    for (const line of ALL_USER_FACING) {
      expect(line).not.toContain("—");
      expect(line).not.toContain("&mdash;");
    }
  });

  it("only the awaiting-confirm placeholder describes a lock (SCRUM-98)", () => {
    // A placeholder may only describe a restriction the component actually
    // enforces. The composer's `disabled` is `streaming || awaitingConfirm`,
    // and connection state is not in it — so of the placeholders that exist,
    // exactly one is allowed to read as "you cannot type until X", and it is
    // the one for the state where typing is genuinely locked. The retired
    // "Connect an account to get started" failed this rule: it told an
    // unconnected user the box was gated while the box sat enabled beneath
    // it, and it kept doing so after the agent had already rendered its own
    // connect ask in the thread. This is a structural pin, not a wording one:
    // a placeholder added back for a connection state lands in
    // ALL_COMPOSER_PLACEHOLDERS (the module exists so no placeholder can hide
    // from the guard) and this assertion goes red until someone re-argues the
    // gate. The rendered-DOM half of the rule lives in
    // agent-composer.test.tsx, which proves the ENABLED composer never wears
    // a lock placeholder.
    const lockShaped = ALL_COMPOSER_PLACEHOLDERS.filter((line) =>
      /\b(connect|approve|deny)\b/i.test(line)
    );
    expect(lockShaped).toEqual([COMPOSER_PLACEHOLDER_AWAITING_CONFIRM]);
  });

  it("keeps its own rules honest", () => {
    // A pattern guard can go blind. If these assertions ever stop matching a
    // known-bad string, they would pass by failing to look, and clean copy and
    // a broken check would be indistinguishable.
    const bad = "Connect an account to try the playground";
    expect(bad.toLowerCase()).toContain("playground");
    expect("a — b").toContain("—");
    // The lock-shaped pattern must still catch the string it retired: if it
    // stops matching "Connect an account to get started", the SCRUM-98 guard
    // above is passing by failing to look.
    expect(/\b(connect|approve|deny)\b/i.test("Connect an account to get started.")).toBe(true);
  });
});
