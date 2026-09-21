import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * D1 (smoke row D1): a row appended to the scratch tab is really
 * there, and is gone afterwards.
 *
 * THE READ-BACK IS THE CASE. `sheets_append` returns success whether or not
 * the row landed where it was meant to, so a test that stopped at the
 * response would pass on a write into the wrong tab.
 */
export const d1SheetsAppend: TestCase = {
  id: "D1",
  title: "a row appended to the lifecycle's sheet reads back and is then removed",
  covers: ["gws-mcp__sheets_append", "gws-mcp__sheets_read", "gws-mcp__sheets_clear"],
  accounts: ["sender"],
  needs: ["SH1"],
  run: async (ctx) => {
  /* WRITES ON THE SCENARIO'S OWN SPREADSHEET, not the standing fixture
   * (HQ, 2026-09-21). This used to write to the fixture sheet's scratch
   * tab, so a cleanup that failed halfway damaged the artefact four read
   * steps and two other scenarios depend on. SH1 creates it, SH5 removes
   * it, and `needs` means this skips with a reason rather than failing
   * against a spreadsheet that was never made. */
    const spreadsheet_id = ctx.from("SH1").spreadsheetId as string;
    const tab = ctx.from("SH1").firstTab as string;
    const marker = `d1-${ctx.stamp}`;

    const appended = await ctx.call(
      "gws-mcp__sheets_append",
      { spreadsheet_id, range: tab, values: [[marker, "appended by the smoke suite"]] },
      { as: "sender" }
    );
    const body = resultJson<{ updates?: { updatedRange?: string }; updatedRange?: string }>(
      "sheets_append",
      appended
    );
    const written = body.updates?.updatedRange ?? body.updatedRange;
    if (!written) throw new Error("sheets_append did not say where it wrote, so nothing can be cleaned up");
    ctx.evidence(`append reported a written range`);

    // Registered IMMEDIATELY after the write, before the assertions, so a
    // failing read-back still cleans up after itself.
    ctx.defer("clear the appended row", async () => {
      await ctx.call("gws-mcp__sheets_clear", { spreadsheet_id, range: written }, { as: "sender" });
    });

    const read = await ctx.call("gws-mcp__sheets_read", { spreadsheet_id, range: tab }, { as: "sender" });
    const rows = resultJson<{ values?: string[][] }>("sheets_read", read).values ?? [];
    const found = rows.filter((r) => r[0] === marker);
    ctx.evidence(`the scratch tab holds ${rows.length} rows, ${found.length} of them this run's`);

    if (found.length === 0) throw new Error("the appended row is not in the tab it was appended to");
    if (found.length > 1) throw new Error("the row was appended more than once");
    if (found[0][1] !== "appended by the smoke suite") {
      throw new Error("the row came back with the wrong second column, so the append misaligned");
    }
  },
};
