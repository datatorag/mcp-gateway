import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * SH2 (Sheets scenario): a batch applies EVERY request, and says so in
 * order.
 *
 * A new step. `sheets_batch_update` is the raw passthrough, so the thing
 * worth asserting is not that one request worked but that a BATCH is a
 * batch: two requests go in, two replies come back, in the order they were
 * sent. A passthrough that quietly applied only the first would look
 * successful from the outside, and the caller would discover it later by
 * finding half their work missing.
 *
 * The replies are what make the assertion possible: `addSheet` answers with
 * the properties it created, so the case learns the ids it needs for its
 * own cleanup rather than guessing them, and the cleanup goes back through
 * the same tool, which is the honest way to remove what a batch created.
 */
export const sh2SheetsBatch: TestCase = {
  id: "SH2",
  title: "a batch of two requests applies both, and replies in order",
  covers: ["gws-mcp__sheets_batch_update"],
  accounts: ["sender"],
  needs: ["SH1"],
  run: async (ctx) => {
    const spreadsheet_id = ctx.from("SH1").spreadsheetId as string;
    const first = `batch-a-${ctx.stamp}`.slice(0, 40);
    const second = `batch-b-${ctx.stamp}`.slice(0, 40);

    const res = await ctx.call(
      "gws-mcp__sheets_batch_update",
      {
        spreadsheet_id,
        requests: [
          { addSheet: { properties: { title: first } } },
          { addSheet: { properties: { title: second } } },
        ],
      },
      { as: "sender" }
    );

    const body = resultJson<{
      replies?: { addSheet?: { properties?: { sheetId?: number; title?: string } } }[];
    }>("sheets_batch_update", res);

    const replies = body.replies ?? [];
    ctx.evidence(`sent 2 requests, got ${replies.length} replies`);

    const ids = replies
      .map((r) => r.addSheet?.properties?.sheetId)
      .filter((id): id is number => typeof id === "number");
    if (ids.length > 0) {
      ctx.defer("remove the tabs the batch created", async () => {
        await ctx.call(
          "gws-mcp__sheets_batch_update",
          { spreadsheet_id, requests: ids.map((sheetId) => ({ deleteSheet: { sheetId } })) },
          { as: "sender" }
        );
      });
    }

    if (replies.length !== 2) {
      throw new Error(`a batch of 2 requests answered with ${replies.length} replies, so it did not apply both`);
    }
    // ORDER, not merely presence. A batch that applied both but reported
    // them transposed would break any caller that matches replies to
    // requests by index, which is the only way they can be matched.
    const titles = replies.map((r) => r.addSheet?.properties?.title);
    if (titles[0] !== first || titles[1] !== second) {
      throw new Error("the batch replied out of order, so a caller cannot match replies to requests by index");
    }
    if (ids.length !== 2) {
      throw new Error("a reply carried no sheet id, so nothing can address or remove what the batch created");
    }
  },
};
