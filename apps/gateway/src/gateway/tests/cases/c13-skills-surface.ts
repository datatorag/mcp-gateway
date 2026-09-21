import type { TestCase } from "../types";
import { firstArray, resultJson } from "../result-json";

/**
 * C13 (tier 1): the gateway's own skills tools answer.
 *
 * The skills surface shipped with no case at all, which meant every Google
 * tool could pass while the front door of that launch was closed. Search
 * then get, because a search that returns a slug nothing can load is a
 * catalogue with no contents behind it.
 *
 * THE RUN PATH IS NOT THIS CASE. Executing a skill in the dashboard agent
 * needs the dashboard and a run budget; it is watched as counts elsewhere,
 * and scoring it here would claim more than this proves.
 */
export const c13SkillsSurface: TestCase = {
  id: "C13",
  title: "skills search returns a skill and skills get loads it",
  tier: 1,
  covers: ["skills_search", "skills_get"],
  accounts: [],
  run: async (ctx) => {
    const found = await ctx.call("skills_search", { query: "email" });
    const hits = firstArray(resultJson("skills_search", found)) ?? [];
    ctx.evidence(`skills_search returned ${hits.length} hit(s)`);

    if (hits.length === 0) {
      throw new Error("the skills catalogue is served but matched nothing, so its front door is closed");
    }
    const first = hits[0] as { slug?: string; title?: string };
    if (!first.slug || !first.title) {
      throw new Error("a search hit came back without a slug or a title, so nothing can be loaded from it");
    }

    const loaded = await ctx.call("skills_get", { slug: first.slug });
    const body = resultJson<{ source?: string; body?: string }>("skills_get", loaded);
    const text = body.source ?? body.body ?? "";
    ctx.evidence(`skills_get returned ${text.length} characters for the first hit`);
    if (text.trim() === "") {
      throw new Error(`skills_get answered nothing for ${first.slug}, so the catalogue lists a skill it cannot serve`);
    }
  },
};
