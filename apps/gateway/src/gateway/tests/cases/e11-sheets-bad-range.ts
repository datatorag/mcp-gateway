import type { TestCase } from "../types";
import { resultText } from "../result-json";

/**
 * E11 (smoke row E11, tier 1): a range naming a tab that does not exist must
 * NAME THE TABS THAT DO.
 *
 * A regression guard with a proven failure: a caller copied the placeholder
 * out of our own parameter description, sent `Sheet1!A1:A100` at a file with
 * no `Sheet1`, and got Google's raw "Unable to parse range" back. That
 * message is true and useless. The fix is an error that tells them what the
 * file actually has, and this case exists so it cannot quietly regress to
 * the upstream text.
 */
export const e11SheetsBadRange: TestCase = {
  id: "E11",
  title: "a range naming a tab that does not exist names the tabs that do",
  tier: 1,
  covers: ["gws-mcp__sheets_find_rows"],
  accounts: ["sender"],
  fixtures: ["sheet", "scratchTab"],
  run: async (ctx) => {
    const absent = `no-such-tab-${ctx.stamp}`;
    const result = await ctx.call(
      "gws-mcp__sheets_find_rows",
      {
        spreadsheet_id: ctx.fixture("sheet"),
        range: `${absent}!A1:A100`,
        column: "A",
        values: ["anything"],
      },
      { as: "sender" }
    );
    const text = resultText(result).trim();
    ctx.evidence(`answered isError=${result.isError === true}, ${text.length} characters`);

    if (!result.isError) throw new Error("a range naming a tab that does not exist was not refused");
    // The claim is that the message is ACTIONABLE, so it must name a tab the
    // file really has. Asserting against the configured scratch tab rather
    // than a literal keeps this out of a public file.
    const real = ctx.fixture("scratchTab");
    if (!text.includes(real)) {
      throw new Error("the error does not name any tab the file actually has, so the caller learns nothing they can act on");
    }
  },
};
