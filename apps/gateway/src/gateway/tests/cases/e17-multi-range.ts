import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * E17 (smoke row E17): many ranges in one call come back IN THE
 * ORDER GIVEN, and arrays survive the trip through `gws_run`.
 *
 * Guards SCRUM-246/253 and SCRUM-178/269. Order is the whole point: a caller
 * that asked for four blocks and matched them up by position gets silently
 * wrong data if the server sorts them, and every value is real so nothing
 * looks wrong. The duplicate and the empty range are the two cases that
 * tempt an implementation to "tidy" the result, by de-duplicating or by
 * dropping a block that matched nothing, and either would shift every later
 * block by one.
 */
export const e17MultiRange: TestCase = {
  id: "E17",
  title: "many ranges answer in request order, keeping duplicates and empty blocks",
  covers: ["gws-mcp__sheets_read", "gws-mcp__gws_run"],
  accounts: ["sender"],
  fixtures: ["sheet", "scratchTab"],
  run: async (ctx) => {
    const spreadsheet_id = ctx.fixture("sheet");
    const tab = ctx.fixture("scratchTab");

    // DELIBERATELY OUT OF SHEET ORDER, with a duplicate and a range nothing
    // answers. The unqualified range targets the first tab, so the request
    // also crosses tabs.
    const ranges = [`${tab}!A3:B4`, `${tab}!A1:B2`, "A1:B2", `${tab}!A1:B2`, `${tab}!Z900:Z901`];

    const read = await ctx.call("gws-mcp__sheets_read", { spreadsheet_id, ranges }, { as: "sender" });
    const blocks = resultJson<{ blocks?: { range?: string; values?: unknown[][] }[] }>(
      "sheets_read",
      read
    ).blocks ?? [];
    ctx.evidence(`asked for ${ranges.length} ranges and got ${blocks.length} blocks`);

    if (blocks.length !== ranges.length) {
      throw new Error(
        `asked for ${ranges.length} ranges and got ${blocks.length} blocks, so a block was dropped or merged and every later block is misaligned`
      );
    }
    // Each block must echo the range it answers, in the slot it was asked in.
    blocks.forEach((block, i) => {
      const echoed = (block.range ?? "").replace(/^'|'/g, "");
      const asked = ranges[i].replace(/^'|'/g, "");
      const tail = asked.includes("!") ? asked.split("!")[1] : asked;
      if (!echoed.includes(tail)) {
        throw new Error(`block ${i + 1} echoes ${JSON.stringify(block.range ?? null)}, which is not the range asked for in that slot`);
      }
    });
    // The duplicate is present twice, not collapsed to one.
    if (blocks[1].range !== blocks[3].range) {
      throw new Error("the duplicated range did not come back twice with the same echo");
    }
    // The empty one occupies its slot rather than vanishing.
    const empty = blocks[4];
    if ((empty.values?.length ?? 0) !== 0) {
      throw new Error("the range nothing answers came back with rows");
    }
    ctx.evidence("order, duplicate and empty slot all held");

    // PART 2: arrays through gws_run, both shapes. A JSON-encoded string is
    // accepted because a caller cannot always send a real array (SCRUM-269).
    const asArray = await ctx.call(
      "gws-mcp__gws_run",
      {
        service: "sheets",
        resource: "spreadsheets",
        method: "get",
        params: { spreadsheetId: spreadsheet_id, ranges: [`${tab}!A1:B2`, `${tab}!A3:B4`], fields: "sheets.data" },
      },
      { as: "sender" }
    );
    const asString = await ctx.call(
      "gws-mcp__gws_run",
      {
        service: "sheets",
        resource: "spreadsheets",
        method: "get",
        params: {
          spreadsheetId: spreadsheet_id,
          ranges: JSON.stringify([`${tab}!A1:B2`, `${tab}!A3:B4`]),
          fields: "sheets.data",
        },
      },
      { as: "sender" }
    );

    const dataBlocks = (r: typeof asArray) => {
      const body = resultJson<{ sheets?: { data?: unknown[] }[] }>("gws_run", r);
      return (body.sheets ?? []).reduce((n, s) => n + (s.data?.length ?? 0), 0);
    };
    const viaArray = dataBlocks(asArray);
    const viaString = dataBlocks(asString);
    ctx.evidence(`gws_run returned ${viaArray} data block(s) for an array and ${viaString} for a JSON string`);

    if (viaArray !== 2) throw new Error(`a real array of two ranges returned ${viaArray} data blocks`);
    if (viaString !== viaArray) {
      throw new Error(`a JSON-encoded array returned ${viaString} data blocks where a real array returned ${viaArray}`);
    }
  },
};
