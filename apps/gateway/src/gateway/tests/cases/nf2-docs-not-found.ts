import type { TestCase } from "../types";
import { expectNotFoundAnswer } from "../not-found-answer";

/** An id in the service's own format that no account here has. */
const MISSING = "1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

/**
 * NF2 (SCRUM-495): an id Google cannot find is refused in words an agent
 * can act on. See `not-found-answer.ts` for what is checked. Read only.
 */
export const nf2DocsNotFound: TestCase = {
  id: "NF2",
  title: "a document id docs cannot find is refused naming the id, the account and drive_search",
  covers: ["gws-mcp__docs_get"],
  accounts: ["sender"],
  run: async (ctx) => {
    const result = await ctx.call("gws-mcp__docs_get", { document_id: MISSING }, { as: "sender" });
    expectNotFoundAnswer(ctx, result, { opens: `Google Docs has no document with the id ${MISSING}`, next: "drive_search" });
  },
};
