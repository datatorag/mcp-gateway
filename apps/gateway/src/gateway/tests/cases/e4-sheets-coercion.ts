import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * E4 (smoke row E4): what the default write mode does to a leading zero
 * and a leading plus, pinned, so a change in it is seen.
 *
 * A CHANGE DETECTOR, not a wish. The default mode types values the way the
 * Sheets UI types them, so "007" is stored as the number 7 and reads back
 * as "7"; that is the endpoint's rule and the tool's description now says
 * so. The leading plus is escaped by the formula guard and survives as
 * text. This case pins BOTH outcomes against that baseline and fails when
 * either moves in either direction: a leading zero that starts surviving
 * means the write mode changed under everyone, which is as much news as a
 * phone number that starts evaluating.
 *
 * The same row is then written with value_input_option RAW, the escape the
 * description promises, and the leading zero must survive there. That is
 * the positive control: it shows the loss above is the mode and not the
 * read, and it keeps the promised escape honest.
 *
 * The sheet says to record EXACTLY what came back, and it still is: the
 * evidence carries the values, whatever the verdict.
 */
export const e4SheetsCoercion: TestCase = {
  id: "E4",
  title: "the default write mode types 007 as 7 and keeps a leading plus, and RAW keeps both",
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
    const leadingZero = "007";
    const phone = "+1 555 0100";
    // The baseline for the default mode. Change these only when the write
    // mode is meant to change, and say so in the changelog.
    const expectedDefault = { leadingZero: "7", phone };

    const appendRow = async (marker: string, extra: Record<string, unknown>): Promise<string[]> => {
      const appended = await ctx.call(
        "gws-mcp__sheets_append",
        { spreadsheet_id, range: tab, values: [[marker, leadingZero, phone]], ...extra },
        { as: "sender" }
      );
      const body = resultJson<{ updates?: { updatedRange?: string }; updatedRange?: string }>(
        "sheets_append",
        appended
      );
      const written = body.updates?.updatedRange ?? body.updatedRange;
      if (written) {
        ctx.defer(`clear the appended row ${marker}`, async () => {
          await ctx.call("gws-mcp__sheets_clear", { spreadsheet_id, range: written }, { as: "sender" });
        });
      }
      const read = await ctx.call("gws-mcp__sheets_read", { spreadsheet_id, range: tab }, { as: "sender" });
      const row = (resultJson<{ values?: string[][] }>("sheets_read", read).values ?? []).find(
        (r) => r[0] === marker
      );
      if (!row) throw new Error(`the appended row ${marker} is not in the tab, so nothing can be concluded about it`);
      return row;
    };

    const byDefault = await appendRow(`e4-${ctx.stamp}`, {});
    // RECORDED WHETHER OR NOT IT PASSES, because the sheet asks for what came
    // back rather than for a verdict alone. The evidence is the point here.
    ctx.evidence(`default mode: sent ${JSON.stringify(leadingZero)}, read ${JSON.stringify(byDefault[1])}`);
    ctx.evidence(`default mode: sent ${JSON.stringify(phone)}, read ${JSON.stringify(byDefault[2])}`);

    if (byDefault[1] !== expectedDefault.leadingZero) {
      throw new Error(
        `the default write mode changed what a leading zero becomes: expected ${JSON.stringify(expectedDefault.leadingZero)}, read ${JSON.stringify(byDefault[1])}`
      );
    }
    if (byDefault[2] !== expectedDefault.phone) {
      throw new Error(
        `the default write mode changed what a leading plus becomes: expected ${JSON.stringify(expectedDefault.phone)}, read ${JSON.stringify(byDefault[2])}`
      );
    }

    const byRaw = await appendRow(`e4-raw-${ctx.stamp}`, { value_input_option: "RAW" });
    ctx.evidence(`RAW: sent ${JSON.stringify(leadingZero)}, read ${JSON.stringify(byRaw[1])}`);
    if (byRaw[1] !== leadingZero) {
      throw new Error(
        `RAW is the promised escape and it did not keep the leading zero: sent ${JSON.stringify(leadingZero)}, read ${JSON.stringify(byRaw[1])}`
      );
    }
    if (byRaw[2] !== phone) {
      throw new Error(`RAW changed the phone number: sent ${JSON.stringify(phone)}, read ${JSON.stringify(byRaw[2])}`);
    }
  },
};
