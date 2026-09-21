import type { TestCase } from "../types";
import { firstArray, resultJson } from "../result-json";

/**
 * C3 (tier 1): the permanent calendar fixture is where it should be.
 *
 * The event is dated years out so it cannot collide with a real meeting,
 * and it is read through LIST over a window rather than GET by id on
 * purpose: list is what an assistant actually calls, and a cancelled event
 * still answers a get (Google tombstones rather than purges), so a get
 * cannot tell "present" from "deleted last week".
 *
 * Deleting the fixture turns this red. That is intended and says so in the
 * event's own description.
 */
export const c3CalendarRead: TestCase = {
  id: "C3",
  title: "the permanent fixture event is listed in its window",
  tier: 1,
  covers: ["gws-mcp__calendar_list_events"],
  accounts: ["sender"],
  fixtures: ["calendarEvent"],
  run: async (ctx) => {
    const result = await ctx.call(
      "gws-mcp__calendar_list_events",
      {
        time_min: "2028-06-14T00:00:00-07:00",
        time_max: "2028-06-16T23:59:59-07:00",
        max_description_chars: 0,
      },
      { as: "sender" }
    );
    const events = firstArray(resultJson("calendar_list_events", result)) ?? [];
    ctx.evidence(`the window listed ${events.length} event(s)`);

    const wanted = ctx.fixture("calendarEvent");
    const found = events.find((e) => (e as { id?: string }).id === wanted) as
      | { summary?: string }
      | undefined;
    if (!found) {
      throw new Error("the permanent fixture event is not in its own window, so either calendar reads are broken or the fixture was deleted");
    }

    const expected = "[smoke-fixture] C3 calendar read fixture - DO NOT DELETE";
    if (found.summary !== expected) {
      throw new Error(`the fixture event's summary is ${JSON.stringify(found.summary ?? null)}, not the control string`);
    }
    ctx.evidence("the fixture event is present with its exact control summary");
  },
};
