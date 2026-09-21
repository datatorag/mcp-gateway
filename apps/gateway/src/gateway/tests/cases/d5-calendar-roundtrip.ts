import type { TestCase } from "../types";
import { firstArray, resultJson } from "../result-json";

/**
 * D5 (smoke row D5): an event created two years out is listed, then
 * deleted, and the deletion is proven by ABSENCE FROM A LISTING.
 *
 * DEVIATION FROM THE SMOKE ROW, ruled by HQ 2026-09-20 and to be folded into
 * the tab: the row says "get it, delete it". A get cannot verify the delete.
 * Measured on 2026-09-20: `calendar_delete_event` reports success and
 * `calendar_get_event` still returns the event with `status: "cancelled"`,
 * because Google tombstones rather than purges. A case that expected the get
 * to fail would have failed after a perfectly good delete. Deletion is
 * therefore verified by absence from `calendar_list_events`, which excludes
 * cancelled events and is what a caller actually sees.
 *
 * NO ATTENDEES and `send_updates: "none"`. A test that mails somebody every
 * time it runs gets itself switched off.
 */
export const d5CalendarRoundTrip: TestCase = {
  id: "D5",
  title: "a created event is listed, then deleted, and the listing no longer has it",
  covers: [
    "gws-mcp__calendar_create_event",
    "gws-mcp__calendar_list_events",
    "gws-mcp__calendar_delete_event",
  ],
  accounts: ["sender"],
  run: async (ctx) => {
    // Far enough out that it cannot collide with a real meeting, and a
    // window this case owns rather than sharing with C3's fixture.
    const start = "2028-11-14T10:00:00-08:00";
    const end = "2028-11-14T10:30:00-08:00";
    const summary = `[smoke] round trip ${ctx.stamp}`;

    const created = await ctx.call(
      "gws-mcp__calendar_create_event",
      {
        summary,
        start,
        end,
        description: "Created by the smoke suite and deleted in the same run.",
        send_updates: "none",
      },
      { as: "sender" }
    );
    const eventId = resultJson<{ id?: string }>("calendar_create_event", created).id;
    if (!eventId) throw new Error("calendar_create_event returned no id, so nothing can be deleted");

    let deleted = false;
    ctx.defer("delete the created event", async () => {
      if (deleted) return;
      await ctx.call(
        "gws-mcp__calendar_delete_event",
        { event_id: eventId, send_updates: "none" },
        { as: "sender" }
      );
    });

    const listed = async () => {
      const res = await ctx.call(
        "gws-mcp__calendar_list_events",
        { time_min: start, time_max: end, max_description_chars: 0 },
        { as: "sender" }
      );
      const events = firstArray(resultJson("calendar_list_events", res)) ?? [];
      return events.some((e) => (e as { id?: string }).id === eventId);
    };

    if (!(await listed())) {
      throw new Error("the created event is not in the window it was created in");
    }
    ctx.evidence("the created event is present in its window");

    await ctx.call(
      "gws-mcp__calendar_delete_event",
      { event_id: eventId, send_updates: "none" },
      { as: "sender" }
    );
    deleted = true;

    if (await listed()) {
      throw new Error("the event is still listed after a delete that reported success");
    }
    ctx.evidence("the window no longer lists it, so the delete really removed it");
  },
};
