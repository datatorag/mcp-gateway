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
 *
 * THE FIRST TAB COMES FROM THE SPREADSHEET, NOT FROM THE CREATE ANSWER.
 * `sheets_create` answers `{spreadsheetId, title, spreadsheetUrl}` and no
 * tab list; this case read `sheets[0]` off that answer as if it were the
 * raw API resource, so it failed on every account and took ten steps with
 * it. The handler was not read before the assertion was written.
 *
 * A FAILURE AFTER THE CREATE DELETES WHAT IT CREATED. The lifetime rule
 * above holds only when this step succeeds: when it throws, no later step
 * runs, SH5 included, and the spreadsheet was left in the account with the
 * cleanup recorded as none needed. The delete is deferred and disarmed
 * once the id has been handed on.
 */
export const sh1SheetsCreate: TestCase = {
  id: "SH1",
  title: "the lifecycle creates the spreadsheet it will write to",
  covers: ["gws-mcp__sheets_create", "gws-mcp__gws_run"],
  // Only when this step fails after the create; otherwise SH5 deletes it.
  cleanupCalls: ["gws-mcp__sheets_delete"],
  accounts: ["sender"],
  run: async (ctx) => {
    const title = `[smoke] sheets lifecycle ${ctx.stamp}`;

    const created = await ctx.call("gws-mcp__sheets_create", { title }, { as: "sender" });
    const body = resultJson<{ spreadsheetId?: unknown }>("sheets_create", created);

    const spreadsheetId = body.spreadsheetId;
    if (typeof spreadsheetId !== "string" || spreadsheetId.trim() === "") {
      throw new Error("sheets_create answered without a spreadsheet id, so nothing downstream can run");
    }

    let handedOn = false;
    ctx.defer("delete the spreadsheet this step made, since the scenario cannot", async () => {
      if (handedOn) return;
      const res = await ctx.call("gws-mcp__sheets_delete", { spreadsheet_id: spreadsheetId }, { as: "sender" });
      if (res.isError) throw new Error("the spreadsheet this step created could not be deleted");
    });

    /* The FIRST TAB'S NAME, because every later step addresses ranges by
     * tab and Google does not promise what a new spreadsheet's first tab is
     * called. Reading it once here is the difference between the scenario
     * working everywhere and working only where the default happens to be
     * "Sheet1". */
    const tabs = resultJson<{ sheets?: unknown }>(
      "gws_run",
      await ctx.call(
        "gws-mcp__gws_run",
        {
          service: "sheets",
          resource: "spreadsheets",
          method: "get",
          params: { spreadsheetId, fields: "sheets.properties.title" },
        },
        { as: "sender" }
      )
    );
    if (!Array.isArray(tabs.sheets)) {
      throw new Error("the spreadsheet's tab list did not come back as a list, so its shape was not read");
    }
    const first = tabs.sheets[0] as { properties?: { title?: unknown } } | undefined;
    const firstTab = first?.properties?.title;
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
    handedOn = true;
  },
};
