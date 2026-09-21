import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * C6 (tier 1): the fixture deck reads back one slide and its control title.
 *
 * The slide COUNT is asserted as well as the text. A deck that gained a
 * slide would still have the right title on the first one, and the count is
 * how this case notices somebody edited a fixture it depends on.
 */
export const c6SlidesRead: TestCase = {
  id: "C6",
  title: "the fixture deck has exactly one slide with its control title",
  tier: 1,
  covers: ["gws-mcp__slides_get"],
  accounts: ["sender"],
  fixtures: ["deck"],
  run: async (ctx) => {
    const result = await ctx.call(
      "gws-mcp__slides_get",
      { presentation_id: ctx.fixture("deck") },
      { as: "sender" }
    );
    const body = resultJson<{
      slides?: { elements?: { placeholderType?: string; text?: string }[] }[];
    }>("slides_get", result);
    const slides = body.slides ?? [];
    ctx.evidence(`the fixture deck has ${slides.length} slide(s)`);

    if (slides.length !== 1) {
      throw new Error(`the fixture deck has ${slides.length} slides, not the one it is supposed to have`);
    }
    const title = slides[0].elements?.find((e) => e.placeholderType === "CENTERED_TITLE");
    const text = (title?.text ?? "").trim();
    if (text !== "SMOKE-C6-CONTROL-TITLE") {
      throw new Error(`the fixture deck's centred title is ${JSON.stringify(text)}, not the control title`);
    }
  },
};
