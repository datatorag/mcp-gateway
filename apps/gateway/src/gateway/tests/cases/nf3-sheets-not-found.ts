import type { TestCase } from "../types";
import { expectNotFoundAnswer } from "../not-found-answer";

/** An id in the service's own format that no account here has. */
const MISSING = "1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

/**
 * NF3 (SCRUM-495): an id Google cannot find is refused in words an agent
 * can act on. See `not-found-answer.ts` for what is checked. Read only.
 */
export const nf3SheetsNotFound: TestCase = {
  id: "NF3",
  title: "a spreadsheet id sheets cannot find is refused naming the id, the account and drive_search",
  covers: ["gws-mcp__sheets_get_metadata"],
  accounts: ["sender"],
  run: async (ctx) => {
    const result = await ctx.call("gws-mcp__sheets_get_metadata", { spreadsheet_id: MISSING }, { as: "sender" });
    expectNotFoundAnswer(ctx, result, { opens: `Google Sheets has no spreadsheet with the id ${MISSING}`, next: "drive_search" });
  },
};
