import type { TestCase } from "../types";
import { expectNotFoundAnswer } from "../not-found-answer";

/** An id in the service's own format that no account here has. */
const MISSING = "aaaaaaaaaaaaaaaaaaaaaaaaaa";

/**
 * NF5 (SCRUM-495): an id Google cannot find is refused in words an agent
 * can act on. See `not-found-answer.ts` for what is checked. Read only.
 */
export const nf5CalendarNotFound: TestCase = {
  id: "NF5",
  title: "an event id calendar cannot find is refused naming the id, the account and calendar_list_events",
  covers: ["gws-mcp__calendar_get_event"],
  accounts: ["sender"],
  run: async (ctx) => {
    const result = await ctx.call("gws-mcp__calendar_get_event", { event_id: MISSING }, { as: "sender" });
    expectNotFoundAnswer(ctx, result, { opens: `Google Calendar has no event with the id ${MISSING} on calendar primary`, next: "calendar_list_events" });
  },
};
