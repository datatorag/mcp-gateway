import type { TestCase } from "../types";
import { expectNotFoundAnswer } from "../not-found-answer";

/** An id in the service's own format that no account here has. */
const MISSING = "1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

/**
 * NF1 (SCRUM-495): an id Google cannot find is refused in words an agent
 * can act on. See `not-found-answer.ts` for what is checked. Read only.
 */
export const nf1DriveNotFound: TestCase = {
  id: "NF1",
  title: "a file id drive cannot find is refused naming the id, the account and drive_search",
  covers: ["gws-mcp__drive_get_file"],
  accounts: ["sender"],
  run: async (ctx) => {
    const result = await ctx.call("gws-mcp__drive_get_file", { file_id: MISSING }, { as: "sender" });
    expectNotFoundAnswer(ctx, result, { opens: `Google Drive has no file or folder with the id ${MISSING}`, next: "drive_search" });
  },
};
