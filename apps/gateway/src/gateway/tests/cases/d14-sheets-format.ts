import type { TestCase } from "../types";
import { resultJson, resultText } from "../result-json";

/**
 * D14 (smoke row D14): a formatting write lands and can be read
 * back.
 *
 * The `sheets_format_*` tools shipped 2026-08-26 with no round trip at all.
 * The read-back cannot use `sheets_read`, which by design returns values and
 * never formatting, so this goes through `gws_run` asking for
 * `userEnteredFormat` on one cell. That is a READ through `gws_run`, which
 * the send guard allows; the guard's read-only rule is what keeps this case
 * from being able to do anything else with that tool.
 *
 * THE ARGUMENTS ARE THE TOOL'S, AND ITS ANSWER IS READ. Run 2 failed this on
 * "not bold after a write that reported success", and nothing had reported
 * success: the case sent `range` where the tool takes a `ranges` array and
 * an RGB object where it takes "#RRGGBB", the tool refused with "names no
 * ranges", and the case never looked at the answer. The argument guard
 * checks top-level names only, so a wrong name inside `formats` passed it.
 *
 * NO FORMATTING CLEANUP. It had one, with the same wrong shape, refused
 * just as silently; and the cell is on the scenario's own spreadsheet,
 * which SH5 deletes whole.
 */
export const d14SheetsFormat: TestCase = {
  id: "D14",
  title: "a bold background written to a cell reads back",
  covers: ["gws-mcp__sheets_format_range", "gws-mcp__gws_run"],
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
    const cell = `${tab}!E1`;

    const readFormat = async () => {
      const res = await ctx.call(
        "gws-mcp__gws_run",
        {
          service: "sheets",
          resource: "spreadsheets",
          method: "get",
          params: {
            spreadsheetId: spreadsheet_id,
            ranges: cell,
            fields: "sheets.data.rowData.values.userEnteredFormat",
          },
        },
        { as: "sender" }
      );
      const body = resultJson<{
        sheets?: { data?: { rowData?: { values?: { userEnteredFormat?: Record<string, unknown> }[] }[] }[] }[];
      }>("gws_run", res);
      return body.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0]?.userEnteredFormat;
    };

    const written = await ctx.call(
      "gws-mcp__sheets_format_range",
      { spreadsheet_id, formats: [{ ranges: [cell], bold: true, background_color: "#FFE699" }] },
      { as: "sender" }
    );
    if (written.isError) {
      throw new Error(`sheets_format_range refused the write: ${resultText(written).slice(0, 200)}`);
    }

    const applied = await readFormat();
    const bold = (applied?.textFormat as { bold?: boolean } | undefined)?.bold === true;
    const coloured = applied?.backgroundColor !== undefined || applied?.backgroundColorStyle !== undefined;
    ctx.evidence(`after the write the cell reads bold=${bold}, background present=${coloured}`);

    if (!bold) throw new Error("the cell is not bold after a formatting write that reported success");
    if (!coloured) throw new Error("the cell has no background colour after a formatting write that reported success");
  },
};
