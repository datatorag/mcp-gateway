import type { TestCase } from "../types";
import { firstArray, resultJson, resultText } from "../result-json";

/**
 * C13: the gateway's own skills tools answer.
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

    // TEXT, NOT JSON, and the tool is right. skills_get exists to load a
    // skill INTO a session: its declared contract is "returns the skill
    // file to follow", prefaced by which services this user has connected.
    // A markdown file is the payload a model acts on, and wrapping it in
    // JSON would serve the test and nobody else. The first draft of this
    // case asserted JSON and was wrong about which side owned the contract.
    const loaded = await ctx.call("skills_get", { slug: first.slug });
    const text = resultText(loaded).trim();
    ctx.evidence(`skills_get returned ${text.length} characters for the first hit`);

    if (loaded.isError) throw new Error(`skills_get answered with an error for ${first.slug}`);
    if (text === "") {
      throw new Error(`skills_get answered nothing for ${first.slug}, so the catalogue lists a skill it cannot serve`);
    }
    // The catalogue must serve THE SKILL IT WAS ASKED FOR. An unknown slug
    // is answered, deliberately, with the list of real slugs rather than an
    // error, so "text came back" on its own cannot tell a hit from a miss.
    if (/^No skill named /.test(text)) {
      throw new Error(`skills_get does not have ${first.slug}, which skills_search just returned`);
    }
  },
};
