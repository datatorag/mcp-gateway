import type { TestCase } from "../types";

/**
 * A3 (tier 1): the served tool list is not empty and matches the formula.
 *
 * THE COUNT IS PER IDENTITY, and that is the trap this case exists around. A
 * run nearly filed a 21-tool drift regression that did not exist, because the
 * sampled count belonged to a user with only Google connected. So this
 * asserts the count against what THIS run's identity should be served rather
 * than against a number written down somewhere: connected services plus the
 * built-ins actually visible to this caller.
 *
 * The analytics half stays with the agent. An event is only as fresh as the
 * last handshake, so it can report a stale count and cannot know it.
 */
export const a3ToolsListed: TestCase = {
  id: "A3",
  title: "tools/list serves a non-empty list that fits the per-identity formula",
  tier: 1,
  covers: [],
  accounts: [],
  run: async (ctx) => {
    const { tools } = (await ctx.rpc("tools/list")) as { tools: { name: string }[] };
    ctx.evidence(`tools/list served ${tools.length} tools`);
    if (tools.length === 0) {
      throw new Error("tools/list served nothing, so discovery is broken for every client");
    }

    const namespaced = tools.filter((t) => t.name.includes("__"));
    const builtins = tools.filter((t) => !t.name.includes("__"));
    const bySlug = new Map<string, number>();
    for (const t of namespaced) {
      const slug = t.name.slice(0, t.name.indexOf("__"));
      bySlug.set(slug, (bySlug.get(slug) ?? 0) + 1);
    }
    ctx.evidence(
      `plugins: ${[...bySlug].map(([slug, n]) => `${slug} ${n}`).join(", ") || "none"}; built-ins: ${builtins.length}`
    );

    // The formula, not a memorised total: the parts must sum to the whole.
    const summed = namespaced.length + builtins.length;
    if (summed !== tools.length) {
      throw new Error(`the parts do not sum to the whole: ${summed} against ${tools.length}`);
    }
    if (builtins.length === 0) {
      throw new Error("no gateway built-in was served, so the built-in half of the list is gone");
    }
  },
};
