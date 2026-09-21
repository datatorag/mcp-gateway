import type { TestCase } from "../types";
import { firstArray, resultJson } from "../result-json";

/**
 * SH5 (Sheets scenario, last step): the lifecycle removes the spreadsheet
 * it made, and proves it is gone.
 *
 * A new step, and the one that closes the loop SH1 opened. It is the whole
 * scenario's cleanup as well as a test of `sheets_delete`, which is why it
 * runs last and why it does not live in a `defer`: the spreadsheet has to
 * outlive every step that writes to it.
 *
 * DELETION IS VERIFIED BY ABSENCE FROM A LISTING, never by a get. That is
 * the standing rule here and it was learned from Calendar, where a delete
 * reported success while a get still returned the event with a cancelled
 * status, so "it is still there" and "it is gone" looked identical. Drive
 * behaves better, but a rule that only applies where it is convenient is
 * not a rule.
 */
export const sh5SheetsDelete: TestCase = {
  id: "SH5",
  title: "the lifecycle deletes its spreadsheet and it is gone from Drive",
  covers: ["gws-mcp__sheets_delete", "gws-mcp__drive_search"],
  accounts: ["sender"],
  needs: ["SH1"],
  run: async (ctx) => {
    const spreadsheet_id = ctx.from("SH1").spreadsheetId as string;
    /* FROM SH1, never rebuilt. `ctx.stamp` is per case, so composing the
     * title here searched for `<run>-SH5` while SH1 had created
     * `<run>-SH1`: the search found nothing, this step refused before
     * calling delete, and the spreadsheet was left in Drive on every run. */
    const title = ctx.from("SH1").title as string;

    /** How many files with this run's exact title Drive can see. */
    const remaining = async (): Promise<number> => {
      const res = await ctx.call(
        "gws-mcp__drive_search",
        /* `page_size`, not `max_results`. Drive and Gmail spell this
         * differently and the contract test is the only reason that was
         * noticed here rather than at 2am in a run. */
        { query: `name = '${title}' and trashed = false`, page_size: 10 },
        { as: "sender" }
      );
      const rows = (firstArray(resultJson("drive_search", res)) ?? []) as unknown[];
      return rows.length;
    };

    const before = await remaining();
    ctx.evidence(`before the delete, Drive lists ${before} file(s) with this run's title`);
    if (before === 0) {
      throw new Error("the spreadsheet this scenario created is already not in Drive, so the delete proves nothing");
    }

    await ctx.call("gws-mcp__sheets_delete", { spreadsheet_id }, { as: "sender" });

    const after = await remaining();
    ctx.evidence(`after the delete, Drive lists ${after}`);
    if (after !== 0) {
      throw new Error(`the spreadsheet is still listed in Drive after being deleted (${after} remaining)`);
    }
  },
};
