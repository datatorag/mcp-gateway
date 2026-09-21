import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * CA2 (Calendar scenario): an update changes the stored event.
 *
 * ON ITS OWN EVENT, never C3's fixture. That fixture is read-only by
 * contract (its summary is a control string two cases pin, and its
 * description says not to delete it), so a case that edited it would break
 * the two cases that read it.
 *
 * THE ASSERTION READS BACK THROUGH A DIFFERENT CALL. `calendar_update_event`
 * returns the patched event, and asserting on that response would pass
 * against a handler that echoed the request without sending it. The summary
 * is therefore re-read with `calendar_get_event`.
 *
 * `send_updates: "none"` with no attendees. The parameter is declared
 * through a shared spread rather than a literal key, and the handler
 * defaults to "all" when it is absent, so it is passed explicitly: an
 * update with attendees and no `send_updates` mails all of them.
 */
export const ca2CalendarUpdate: TestCase = {
  id: "CA2",
  title: "updating an event's summary changes what a later get returns",
  covers: [
    "gws-mcp__calendar_create_event",
    "gws-mcp__calendar_update_event",
    "gws-mcp__calendar_get_event",
    "gws-mcp__calendar_delete_event",
  ],
  accounts: ["sender"],
  run: async (ctx) => {
    // Its own window, years out, shared with neither C3 nor D5.
    const start = "2028-11-15T09:00:00-08:00";
    const end = "2028-11-15T09:30:00-08:00";
    const before = `[smoke] CA2 before ${ctx.stamp}`;
    const after = `[smoke] CA2 after ${ctx.stamp}`;

    const created = resultJson<{ id?: string }>(
      "calendar_create_event",
      await ctx.call(
        "gws-mcp__calendar_create_event",
        {
          summary: before,
          start,
          end,
          description: "Created by the smoke suite, updated, and deleted in the same run.",
          send_updates: "none",
        },
        { as: "sender" }
      )
    );
    const event_id = created.id;
    if (!event_id) throw new Error("calendar_create_event returned no id, so there is nothing to update");

    // BY ID, and registered before the update so a failed update still
    // cleans up. The id is in hand here, unlike DR1's folder, so the
    // closure cannot see undefined.
    ctx.defer("delete the created event", async () => {
      await ctx.call(
        "gws-mcp__calendar_delete_event",
        { event_id, send_updates: "none" },
        { as: "sender" }
      );
    });

    await ctx.call(
      "gws-mcp__calendar_update_event",
      { event_id, summary: after, send_updates: "none" },
      { as: "sender" }
    );

    const reread = resultJson<{ id?: string; summary?: string }>(
      "calendar_get_event",
      await ctx.call("gws-mcp__calendar_get_event", { event_id }, { as: "sender" })
    );
    if (reread.id !== event_id) {
      throw new Error("the re-read answered about a different event than the one updated");
    }
    if (reread.summary === before) {
      throw new Error("the event still carries its original summary, so the update did not take");
    }
    if (reread.summary !== after) {
      throw new Error(
        `the updated event's summary is ${JSON.stringify(reread.summary ?? null)}, which is neither the summary it was created with nor the one it was updated to`
      );
    }
    ctx.evidence("the summary changed from the created value to the updated one");
  },
};
