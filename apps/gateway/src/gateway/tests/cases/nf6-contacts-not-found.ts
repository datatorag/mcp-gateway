import type { TestCase } from "../types";
import { expectNotFoundAnswer } from "../not-found-answer";

/** An id in the service's own format that no account here has. */
const MISSING = "people/c0000000000000000001";

/**
 * NF6 (SCRUM-495): an id Google cannot find is refused in words an agent
 * can act on. See `not-found-answer.ts` for what is checked. Read only.
 */
export const nf6ContactsNotFound: TestCase = {
  id: "NF6",
  title: "a contact contacts cannot find is refused naming it, the account and contacts_search",
  covers: ["gws-mcp__contacts_get"],
  accounts: ["sender"],
  run: async (ctx) => {
    const result = await ctx.call("gws-mcp__contacts_get", { resource_name: MISSING }, { as: "sender" });
    expectNotFoundAnswer(ctx, result, { opens: `Google Contacts has no contact with the id ${MISSING}`, next: "contacts_search" });
  },
};
