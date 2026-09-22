/**
 * The skill reader reaches every bundle in the process (SCRUM-303).
 *
 * `server.ts` sets the reader at boot, in the Express bundle. Next compiles
 * this module again into its own bundle, and the admin test route and the
 * dashboard agent both build their MCP server there. With the reader in a
 * module-level variable, that second copy never saw it, so every lookup
 * fell back to the published snapshot: a user's own skill could not be
 * found by its slug (SK1) and a fork did not replace the published slug
 * (SK2), in exactly the two places a user's own skills are used.
 *
 * Two module instances stand in for the two bundles.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(async () => {
  vi.resetModules();
  const skills = await import("./skills");
  skills.setSkillReader(null);
});

describe("the skill reader across bundles", () => {
  it("is visible to a second instance of the module", async () => {
    vi.resetModules();
    const express = await import("./skills");
    vi.resetModules();
    const next = await import("./skills");
    expect(next).not.toBe(express);

    const own = { slug: "mine", title: "Mine" } as unknown as Awaited<ReturnType<typeof express.getSkillBySlug>>;
    express.setSkillReader({
      listForViewer: async () => (own ? [own] : []),
      findForViewer: async (_viewer, slug) => (slug === "mine" ? own : null),
    });

    await expect(next.getSkillBySlug("mine", "user-1")).resolves.toBe(own);
    await expect(next.getAllSkills("user-1")).resolves.toEqual([own]);
  });
});
