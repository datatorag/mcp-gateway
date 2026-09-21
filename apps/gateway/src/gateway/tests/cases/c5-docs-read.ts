import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * C5: the fixture doc reads back its control heading.
 *
 * FIRST LINE, exactly. A docs read that returned the document in the wrong
 * order, or returned a neighbouring document, would still return text.
 */
export const c5DocsRead: TestCase = {
  id: "C5",
  title: "the fixture doc's first line is its control heading",
  covers: ["gws-mcp__docs_get"],
  accounts: ["sender"],
  fixtures: ["doc"],
  run: async (ctx) => {
    const result = await ctx.call(
      "gws-mcp__docs_get",
      { document_id: ctx.fixture("doc"), mode: "text" },
      { as: "sender" }
    );
    const body = resultJson<{ text?: string }>("docs_get", result);
    const first = (body.text ?? "").split("\n")[0]?.trim() ?? "";
    ctx.evidence(`the fixture doc's first line is ${first.length} characters`);

    if (first !== "SMOKE-C5-CONTROL-HEADING") {
      throw new Error(`the fixture doc's first line is ${JSON.stringify(first)}, not the control heading`);
    }
  },
};
