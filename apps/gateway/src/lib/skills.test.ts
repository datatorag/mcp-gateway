import { describe, expect, it } from "vitest";
import { connectorsFor, getAllSkills, getRelatedSkills } from "./skills";
import { REGISTRY_TOOL_NAMES } from "@/gateway/playground/registry-snapshot";

/** A published skill may only name tools we actually ship.
 *
 * Derived from the gate's reviewed registry snapshot rather than listed
 * again here: the two lists were 76-of-77 identical and had already drifted
 * (sheets_add_tab was in one and not the other). One record, two readers.
 *
 * The rule matters because a skill is copied verbatim into a reader's agent:
 * naming a tool we do not ship is worse than shipping no skill, because it
 * fails on them, not on us. */
const SHIPPED_TOOLS = REGISTRY_TOOL_NAMES;

const skills = getAllSkills();

describe("the skills collection", () => {
  it("parses every file in content/skills", () => {
    expect(skills.length).toBeGreaterThan(0);
  });

  it.each(skills.map((s) => [s.slug, s] as const))(
    "%s names only tools we actually ship",
    (_slug, skill) => {
      for (const tool of skill.tools) {
        expect(SHIPPED_TOOLS.has(tool), `unshipped tool: ${tool}`).toBe(true);
      }
    }
  );

  it.each(skills.map((s) => [s.slug, s] as const))(
    "%s carries the fields the page and its metadata need",
    (_slug, skill) => {
      expect(skill.title).toBeTruthy();
      expect(skill.situation).toBeTruthy();
      expect(skill.produces).toBeTruthy();
      expect(skill.tools.length).toBeGreaterThan(0);
      expect(connectorsFor(skill.tools).length).toBeGreaterThan(0);
    }
  );

  it.each(skills.map((s) => [s.slug, s] as const))(
    "%s exposes a copyable skill file, and every tool it names appears in it",
    (_slug, skill) => {
      // The copy payload is the artifact itself, not a summary of one.
      expect(skill.skillSource).toContain("---");
      expect(skill.skillSource).toContain("name:");
      expect(skill.skillSource.length).toBeGreaterThan(200);
      // `tools` is the surface the skill operates over, not a strict call
      // list — a run may legitimately reach for a declared tool the file
      // does not spell out (week-ahead can use calendar_freebusy for its
      // thin/heavy-days step). So the invariant is that the frontmatter and
      // the file are about the same thing, not that they match one-to-one;
      // the hard rule, that every declared tool actually ships, is pinned
      // separately above.
      expect(
        skill.tools.some((tool) => skill.skillSource.includes(tool)),
        "frontmatter tools and the skill file are unrelated"
      ).toBe(true);
    }
  );

  it("splits intro and notes around the skill file", () => {
    for (const skill of skills) {
      expect(skill.introHtml).toContain("<");
      expect(skill.notesHtml).toContain("Notes from running this");
      // The fenced artifact must not leak into the rendered prose, or it
      // would appear twice on the page.
      expect(skill.introHtml).not.toContain("```");
    }
  });

  it("relates skills without reaching for the blog's tag model", () => {
    for (const skill of skills) {
      const related = getRelatedSkills(skill.slug);
      expect(related.length).toBeGreaterThan(0);
      expect(related.map((r) => r.slug)).not.toContain(skill.slug);
    }
  });
});
