import { SKILL_RUN_EFFORT, type SkillRunEffort } from "@/gateway/billing/plans";

/**
 * The thinking setting a skill run carries (SCRUM-248).
 *
 * A skill-seeded turn asks the provider for adaptive thinking at a bounded
 * effort, so a long step thinks less before its first tool call or word.
 * The level is the constant beside the ceiling unless the skill names its
 * own in frontmatter. The options are provider-specific by nature: another
 * provider ignores this key and runs at its own default, which is the same
 * fallback the cache breakpoints have.
 */

const LEVELS: readonly SkillRunEffort[] = ["low", "medium", "high"];

export function isSkillRunEffort(value: unknown): value is SkillRunEffort {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value);
}

/** The effort a skill runs at: its own override when valid, else the constant. */
export function skillRunEffort(skill: { effort?: SkillRunEffort | undefined }): SkillRunEffort {
  return isSkillRunEffort(skill.effort) ? skill.effort : SKILL_RUN_EFFORT;
}

/** What the chat route hands the runtime for a skill-seeded turn, and only
 * for one. The shape is the provider's: adaptive thinking, and the effort
 * that sets its depth. */
export function skillRunProviderOptions(skill: { effort?: SkillRunEffort | undefined }) {
  return {
    anthropic: { thinking: { type: "adaptive" as const }, effort: skillRunEffort(skill) },
  };
}
