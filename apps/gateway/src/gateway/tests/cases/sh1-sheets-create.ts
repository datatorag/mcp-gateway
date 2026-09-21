import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * SH1 (Sheets scenario, step 1): the lifecycle makes its own spreadsheet.
 *
 * A new step, and the reason the rest of this scenario changed shape. Every
 * write step used to run against the STANDING FIXTURE sheet's scratch tab,
 * which meant a cleanup that failed halfway damaged the one artefact four
 * read steps and two other scenarios depend on. HQ ruled on 2026-09-21 that
 * the write path gets its own spreadsheet and the fixture sheet becomes
 * read-only; this is that spreadsheet.
 *
 * ITS LIFETIME IS THE SCENARIO'S, NOT THIS CASE'S, which is the one thing
 * to understand here. `ctx.defer` runs when the case that registered it
 * ends, so deleting it here would delete it before step 2. The delete step
 * at the end of the scenario owns the removal, and every step in between
 * declares `needs: ["SH1"]`, so if this step fails they skip with a reason
 * instead of failing one by one against a spreadsheet that never existed.
 *
 * The name carries the run stamp so an interrupted run leaves something a
 * later one can recognise as its own litter rather than a real document.
 */
export const sh1SheetsCreate: TestCase = {
  id: "SH1",
  title: "the lifecycle creates the spreadsheet it will write to",
  covers: ["gws-mcp__sheets_create"],
  accounts: ["sender"],
  run: async (ctx) => {
    const title = `[smoke] sheets lifecycle ${ctx.stamp}`;

    const created = await ctx.call("gws-mcp__sheets_create", { title }, { as: "sender" });
    const body = resultJson<{
      spreadsheetId?: unknown;
      properties?: { title?: unknown };
      sheets?: { properties?: { title?: unknown } }[];
    }>("sheets_create", created);

    const spreadsheetId = body.spreadsheetId;
    if (typeof spreadsheetId !== "string" || spreadsheetId.trim() === "") {
      throw new Error("sheets_create answered without a spreadsheet id, so nothing downstream can run");
    }

    /* The FIRST TAB'S NAME, because every later step addresses ranges by
     * tab and Google does not promise what a new spreadsheet's first tab is
     * called. Reading it once here is the difference between the scenario
     * working everywhere and working only where the default happens to be
     * "Sheet1". */
    const firstTab = body.sheets?.[0]?.properties?.title;
    if (typeof firstTab !== "string" || firstTab.trim() === "") {
      throw new Error("the new spreadsheet reports no first tab, so no later step can name a range");
    }

    ctx.evidence(`created a spreadsheet whose first tab is "${firstTab}"`);
    // The id is NEVER put in evidence: it is a real Drive id and this
    // repository's evidence is rendered on a page and stored.
    /* THE TITLE TRAVELS TOO. `ctx.stamp` is per CASE, so SH5 rebuilding
     * the title from its own stamp searched Drive for a file that never
     * existed, found nothing, and refused before it ever called delete.
     * Every run would have created a spreadsheet and left it there. */
    ctx.share({ spreadsheetId, firstTab, title });
  },
};
