import type { TestCase } from "../types";
import { resultJson } from "../result-json";
import { FIXTURE_SUMMARY } from "./c3-calendar-read";

/**
 * CA1 (Calendar scenario): a get by id returns THAT event.
 *
 * `calendar_get_event` had no case. C3 reads the fixture through LIST and
 * says why: a cancelled event still answers a get, so a get cannot tell
 * "present" from "deleted last week". That makes list the right tool for
 * PRESENCE and leaves get untested, which is what this step closes.
 *
 * What a get is good for is the detail a listing does not carry. The
 * assertion is therefore identity plus a field: the returned `id` is the
 * one asked for, and the summary is the fixture's exact control string.
 * Asserting only that the call succeeds would pass against a reader
 * returning any event in the calendar.
 */
export const ca1CalendarGet: TestCase = {
  id: "CA1",
  title: "getting the fixture event by id returns that event with its control summary",
  covers: ["gws-mcp__calendar_get_event"],
  accounts: ["sender"],
  fixtures: ["calendarEvent"],
  run: async (ctx) => {
    const event_id = ctx.fixture("calendarEvent");
    const event = resultJson<{ id?: string; summary?: string }>(
      "calendar_get_event",
      await ctx.call("gws-mcp__calendar_get_event", { event_id }, { as: "sender" })
    );

    if (event.id !== event_id) {
      throw new Error(
        `calendar_get_event returned id ${JSON.stringify(event.id ?? null)} for a get of ${JSON.stringify(event_id)}, so it answered about a different event`
      );
    }
    /* The same control string C3 pins through the listing, imported rather
     * than repeated, so a rename breaks both from one edit. */
    if (event.summary !== FIXTURE_SUMMARY) {
      throw new Error(
        `the fixture event's summary through get is ${JSON.stringify(event.summary ?? null)}, not the control string`
      );
    }
    ctx.evidence("the get answered with the fixture's own id and control summary");
  },
};
