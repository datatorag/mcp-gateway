import { describe, expect, it } from "vitest";

import { RUN_TOKEN_CEILING, SKILL_RUN_EFFORT } from "@/gateway/billing/plans";
import { skillRunEffort, skillRunProviderOptions } from "./run-effort";

/**
 * SCRUM-248: a skill-seeded turn asks the model for a bounded amount of
 * thinking per step. Thinking is most of what a later step costs, and the
 * ceiling alone only stops a run one step after the damage.
 */
describe("the skill run effort (SCRUM-248)", () => {
  it("is one constant beside the ceiling, and it is medium", () => {
    expect(SKILL_RUN_EFFORT).toBe("medium");
    expect(RUN_TOKEN_CEILING).toBeGreaterThan(0);
  });

  it("a skill with no override runs at the constant", () => {
    expect(skillRunEffort({ effort: undefined })).toBe(SKILL_RUN_EFFORT);
    expect(skillRunEffort({})).toBe(SKILL_RUN_EFFORT);
  });

  it("a frontmatter override wins over the constant, within the allowed levels", () => {
    expect(skillRunEffort({ effort: "low" })).toBe("low");
    expect(skillRunEffort({ effort: "high" })).toBe("high");
    expect(skillRunEffort({ effort: "medium" })).toBe("medium");
  });

  it("a value outside the allowed levels falls back to the constant rather than reaching the provider", () => {
    expect(skillRunEffort({ effort: "max" as never })).toBe(SKILL_RUN_EFFORT);
    expect(skillRunEffort({ effort: "" as never })).toBe(SKILL_RUN_EFFORT);
  });

  it("the provider options say adaptive thinking plus the effort, and nothing else", () => {
    expect(skillRunProviderOptions({ effort: undefined })).toEqual({
      anthropic: { thinking: { type: "adaptive" }, effort: "medium" },
    });
    expect(skillRunProviderOptions({ effort: "low" })).toEqual({
      anthropic: { thinking: { type: "adaptive" }, effort: "low" },
    });
  });
});
