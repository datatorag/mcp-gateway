import type { TestCase } from "../types";
import { resultJson } from "../result-json";

type Calendars = {
  count?: number;
  calendars?: { id?: string; summary?: string; primary?: boolean; access_role?: string; time_zone?: string }[];
};
type Suggested = {
  time_zone?: string;
  checked?: string[];
  could_not_check?: { id: string; reason: string }[];
  suggestions?: { start: string; end: string; local: string }[];
};

/**
 * CA4 (Calendar scenario, SCRUM-428): `calendar_list_calendars` lists the
 * account's calendars compactly, and `calendar_suggest_time` stops offering a
 * slot once an event of this case's own occupies it.
 *
 * The suggestion claim is a DIFFERENCE, as CA3's is: the same window asked
 * twice, before and after this case books its middle hour. Asserting only
 * that a busy slot is left out would pass for a tool that suggests nothing;
 * asserting only that a free slot is offered would pass for one that ignores
 * busy time. The earlier hour is the control, offered both times.
 *
 * The attendee is the reader mailbox. Its free/busy may not be visible to the
 * sender account (two accounts that share nothing answer notFound), and the
 * tool then lists it under could_not_check, which this case records as
 * evidence rather than failing on: what is under test is the sender's own
 * calendar, which the tool always checks.
 */
export const ca4CalendarCalendarsSuggest: TestCase = {
  id: "CA4",
  title: "the calendar list is compact, and a suggested slot disappears once an event takes it",
  covers: [
    "gws-mcp__calendar_list_calendars",
    "gws-mcp__calendar_suggest_time",
    "gws-mcp__calendar_create_event",
    "gws-mcp__calendar_delete_event",
  ],
  accounts: ["sender", "reader"],
  timeoutMs: 120_000,
  run: async (ctx) => {
    const listed = resultJson<Calendars>(
      "calendar_list_calendars",
      await ctx.call("gws-mcp__calendar_list_calendars", { max_results: 50 }, { as: "sender" })
    );
    const calendars = listed.calendars ?? [];
    const primaries = calendars.filter((c) => c.primary === true);
    ctx.evidence(`the account lists ${calendars.length} calendar(s), ${primaries.length} of them primary`);
    if (primaries.length !== 1) throw new Error(`expected exactly one primary calendar, found ${primaries.length}`);
    const allowed = new Set(["id", "summary", "primary", "access_role", "time_zone"]);
    for (const c of calendars) {
      const extra = Object.keys(c).filter((k) => !allowed.has(k));
      if (extra.length > 0) throw new Error(`a calendar entry carries fields beyond the compact five: ${extra.join(", ")}`);
    }
    if (primaries[0].access_role !== "owner") throw new Error(`the primary calendar's access role is ${primaries[0].access_role}, not owner`);

    // A Tuesday far enough out that the fixture accounts' calendars are empty.
    const timeZone = "America/Los_Angeles";
    const ask = async () =>
      resultJson<Suggested>(
        "calendar_suggest_time",
        await ctx.call(
          "gws-mcp__calendar_suggest_time",
          {
            attendees: ctx.address("reader"),
            duration_minutes: 60,
            time_min: "2028-11-21T09:00:00-08:00",
            time_max: "2028-11-21T12:00:00-08:00",
            time_zone: timeZone,
            working_hours_start: 9,
            working_hours_end: 12,
            max_suggestions: 10,
          },
          { as: "sender" }
        )
      );
    const starts = (s: Suggested) => (s.suggestions ?? []).map((x) => x.start);
    const NINE = "2028-11-21T17:00:00.000Z";
    const TEN = "2028-11-21T18:00:00.000Z";

    const before = await ask();
    ctx.evidence(
      `before: ${starts(before).length} slot(s); checked ${JSON.stringify(before.checked)}; could not check ${JSON.stringify(before.could_not_check)}`
    );
    if (!(before.checked ?? []).includes("primary")) throw new Error("the account's own calendar was not checked");
    if (before.time_zone !== timeZone) throw new Error(`the answer used ${before.time_zone}, not the zone asked for`);
    for (const slot of [NINE, TEN]) {
      if (!starts(before).includes(slot)) {
        throw new Error(`${slot} is not offered before anything is booked, so the window is not free and the comparison below proves nothing`);
      }
    }

    const created = resultJson<{ id?: string }>(
      "calendar_create_event",
      await ctx.call(
        "gws-mcp__calendar_create_event",
        {
          summary: `[smoke] CA4 occupies 10:00 ${ctx.stamp}`,
          start: "2028-11-21T10:00:00-08:00",
          end: "2028-11-21T11:00:00-08:00",
          send_updates: "none",
        },
        { as: "sender" }
      )
    );
    const event_id = created.id;
    if (!event_id) throw new Error("calendar_create_event returned no id, so nothing occupies the slot");
    ctx.defer("delete the created event", async () => {
      await ctx.call("gws-mcp__calendar_delete_event", { event_id, send_updates: "none" }, { as: "sender" });
    });

    // POLLED: free/busy is derived and can lag a write.
    const after = await ctx.until(
      "the booked hour to leave the suggestions",
      async () => {
        const s = await ask();
        return starts(s).includes(TEN) ? undefined : s;
      },
      { everyMs: 3_000, forMs: 60_000 }
    );
    ctx.evidence(`after booking 10:00: offered ${JSON.stringify(starts(after))}`);
    if (!starts(after).includes(NINE)) throw new Error("the 9:00 control left the suggestions too, so they are not tracking the booked hour");
  },
};
