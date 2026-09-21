import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * E9 (smoke row E9, tier 1): a partial read works AND says it is partial.
 *
 * A regression guard. `docs_get` once accepted only a document id and a
 * mode, so a caller who wanted part of a long document invented a parameter
 * that did not exist and the call failed (SCRUM-174). Adding the range was
 * half the fix; the other half is that the response says how much document
 * there is and whether the slice was clipped, because a caller who cannot
 * tell a complete answer from a truncated one will treat the truncation as
 * the whole document.
 */
export const e9DocsPartial: TestCase = {
  id: "E9",
  title: "a partial doc read returns the slice and says the document is longer",
  tier: 1,
  covers: ["gws-mcp__docs_get"],
  accounts: ["sender"],
  fixtures: ["doc"],
  run: async (ctx) => {
    const document_id = ctx.fixture("doc");

    const whole = resultJson<{ text?: string }>(
      "docs_get",
      await ctx.call("gws-mcp__docs_get", { document_id, mode: "text" }, { as: "sender" })
    ).text ?? "";
    if (whole.length < 40) {
      throw new Error("the fixture doc is too short for a partial read to mean anything");
    }

    const sliced = resultJson<{ text?: string; totalEndIndex?: number; clipped?: boolean }>(
      "docs_get",
      await ctx.call(
        "gws-mcp__docs_get",
        { document_id, mode: "text", start_index: 1, end_index: 20 },
        { as: "sender" }
      )
    );
    const text = sliced.text ?? "";
    ctx.evidence(`the whole doc is ${whole.length} characters, the slice ${text.length}`);

    if (text.length >= whole.length) {
      throw new Error("a ranged read returned the whole document, so the range was ignored");
    }
    // THE HALF THAT MATTERS: a caller must be able to tell this was partial.
    if (typeof sliced.totalEndIndex !== "number") {
      throw new Error("the ranged read does not say how long the document is, so a caller cannot tell a slice from the whole");
    }
    if (sliced.clipped !== true) {
      throw new Error("the ranged read does not report being clipped, so a truncated answer reads as a complete one");
    }
  },
};
