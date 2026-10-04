import type { TestCase } from "../types";
import { resultText } from "../result-json";

/**
 * E18: a query over a tab that does not exist is REFUSED, and the refusal
 * names a tab the file really has.
 *
 * A regression guard with a proven failure. The query endpoint behind
 * sheets_query does not reject a tab it cannot find: it answers with the
 * FIRST tab's rows and no error. A misspelt tab therefore came back as a
 * confident table from the wrong tab, which is worse than an error because
 * nothing about it looks wrong. The tool now reads the file's tab list first
 * and refuses, and this case exists so that cannot quietly regress to a
 * table.
 *
 * It asserts the refusal, not the rows: the absent tab's name carries the
 * run's stamp, so no real tab can ever match it.
 */
export const e18QueryUnknownTab: TestCase = {
  id: "E18",
  title: "a query over a tab that does not exist is refused, naming the tabs that do",
  covers: ["gws-mcp__sheets_query"],
  accounts: ["sender"],
  fixtures: ["sheet", "scratchTab"],
  run: async (ctx) => {
    const absent = `no-such-tab-${ctx.stamp}`;
    const result = await ctx.call(
      "gws-mcp__sheets_query",
      { spreadsheet_id: ctx.fixture("sheet"), range: `${absent}!A:B`, query: "select A limit 1" },
      { as: "sender" }
    );
    const text = resultText(result).trim();
    ctx.evidence(`answered isError=${result.isError === true}, ${text.length} characters`);

    if (!result.isError) {
      throw new Error("a query over a tab that does not exist was answered with rows, which are another tab's");
    }
    // Asserted against the configured scratch tab rather than a literal, so
    // no real tab name sits in a public file.
    const real = ctx.fixture("scratchTab");
    if (!text.includes(real)) {
      throw new Error("the refusal does not name any tab the file actually has, so the caller learns nothing they can act on");
    }
  },
};
