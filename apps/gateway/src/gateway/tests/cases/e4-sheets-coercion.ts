import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * E4 (smoke row E4, tier 2): a leading-zero string and a phone number keep
 * their shape.
 *
 * The sheet says to record EXACTLY what came back, and that wording is
 * deliberate: this case is about type coercion, where the failure is a value
 * that is still there and still plausible. `007` becoming `7` and
 * `+1 555 0100` becoming a formula are the two that bite, and both look like
 * data until somebody compares them.
 */
export const e4SheetsCoercion: TestCase = {
  id: "E4",
  title: "a leading zero and a leading plus survive a round trip unchanged",
  tier: 2,
  covers: ["gws-mcp__sheets_append", "gws-mcp__sheets_read", "gws-mcp__sheets_clear"],
  accounts: ["sender"],
  fixtures: ["sheet", "scratchTab"],
  serial: "scratch-tab",
  run: async (ctx) => {
    const spreadsheet_id = ctx.fixture("sheet");
    const tab = ctx.fixture("scratchTab");
    const marker = `e4-${ctx.stamp}`;
    const leadingZero = "007";
    const phone = "+1 555 0100";

    const appended = await ctx.call(
      "gws-mcp__sheets_append",
      { spreadsheet_id, range: tab, values: [[marker, leadingZero, phone]] },
      { as: "sender" }
    );
    const body = resultJson<{ updates?: { updatedRange?: string }; updatedRange?: string }>(
      "sheets_append",
      appended
    );
    const written = body.updates?.updatedRange ?? body.updatedRange;
    if (written) {
      ctx.defer("clear the appended row", async () => {
        await ctx.call("gws-mcp__sheets_clear", { spreadsheet_id, range: written }, { as: "sender" });
      });
    }

    const read = await ctx.call("gws-mcp__sheets_read", { spreadsheet_id, range: tab }, { as: "sender" });
    const row = (resultJson<{ values?: string[][] }>("sheets_read", read).values ?? []).find(
      (r) => r[0] === marker
    );
    if (!row) throw new Error("the appended row is not in the tab, so nothing can be concluded about it");

    // RECORDED WHETHER OR NOT IT PASSES, because the sheet asks for what came
    // back rather than for a verdict alone. The evidence is the point here.
    ctx.evidence(`sent ${JSON.stringify(leadingZero)}, read ${JSON.stringify(row[1])}`);
    ctx.evidence(`sent ${JSON.stringify(phone)}, read ${JSON.stringify(row[2])}`);

    if (row[1] !== leadingZero) {
      throw new Error(`the leading zero was lost: sent ${JSON.stringify(leadingZero)}, read ${JSON.stringify(row[1])}`);
    }
    if (row[2] !== phone) {
      throw new Error(`the phone number changed: sent ${JSON.stringify(phone)}, read ${JSON.stringify(row[2])}`);
    }
  },
};
