import type { TestCase } from "../types";
import { resultJson } from "../result-json";

type RawEvent = { id?: string; attendees?: { email?: string; self?: boolean; responseStatus?: string; comment?: string }[] };

/**
 * CA5 (Calendar scenario, SCRUM-428): `calendar_respond_to_event` records an
 * answer to an invitation, and the ORGANIZER's copy of the event shows it.
 *
 * The sender creates an event with the reader as its only guest, with
 * send_updates none so no mail goes anywhere; Google still puts the event on
 * the reader's calendar. The reader answers twice, tentative then accepted,
 * each with send_updates none, which the runner's guard requires. Each answer
 * is read back from the sender's side, because the tool's own reply is what
 * a handler that changed nothing could also say. Two answers, so a status
 * that was already there cannot pass for one this case set.
 */
export const ca5CalendarRespond: TestCase = {
  id: "CA5",
  title: "an answer to an invitation is what the organizer then sees",
  covers: ["gws-mcp__calendar_respond_to_event", "gws-mcp__calendar_create_event", "gws-mcp__calendar_delete_event", "gws-mcp__gws_run"],
  accounts: ["sender", "reader"],
  distinctAccounts: true,
  timeoutMs: 150_000,
  run: async (ctx) => {
    const reader = ctx.address("reader").toLowerCase();
    const created = resultJson<{ id?: string }>(
      "calendar_create_event",
      await ctx.call(
        "gws-mcp__calendar_create_event",
        {
          summary: `[smoke] CA5 invitation ${ctx.stamp}`,
          start: "2028-11-22T09:00:00-08:00",
          end: "2028-11-22T09:30:00-08:00",
          attendees: ctx.address("reader"),
          send_updates: "none",
        },
        { as: "sender" }
      )
    );
    const event_id = created.id;
    if (!event_id) throw new Error("calendar_create_event returned no id, so there is no invitation to answer");
    ctx.defer("delete the invitation", async () => {
      await ctx.call("gws-mcp__calendar_delete_event", { event_id, send_updates: "none" }, { as: "sender" });
    });

    const get = { service: "calendar", resource: "events", method: "get", params: { calendarId: "primary", eventId: event_id } };
    // Two literal roles, not one variable: the role check reads them from source.
    const read = async (as: "sender" | "reader") =>
      resultJson<RawEvent>(
        "gws_run",
        as === "reader"
          ? await ctx.call("gws-mcp__gws_run", get, { as: "reader" })
          : await ctx.call("gws-mcp__gws_run", get, { as: "sender" })
      );

    // The invitation has to be on the reader's calendar before it can be answered.
    await ctx.until(
      "the invitation to reach the reader's calendar",
      async () => {
        try {
          const e = await read("reader");
          return e.id ? e : undefined;
        } catch {
          return undefined;
        }
      },
      { everyMs: 3_000, forMs: 60_000 }
    );

    for (const response of ["tentative", "accepted"] as const) {
      const answered = resultJson<{ response?: string; comment?: string }>(
        "calendar_respond_to_event",
        await ctx.call(
          "gws-mcp__calendar_respond_to_event",
          { event_id, response, comment: `CA5 ${response}`, send_updates: "none" },
          { as: "reader" }
        )
      );
      if (answered.response !== response) throw new Error(`the tool answered ${answered.response} for a ${response} response`);
      const seen = await ctx.until(
        `the organizer to see ${response}`,
        async () => {
          const guest = (await read("sender")).attendees?.find((a) => a.email?.toLowerCase() === reader);
          return guest?.responseStatus === response ? guest : undefined;
        },
        { everyMs: 3_000, forMs: 45_000 }
      );
      ctx.evidence(`the organizer sees the reader's answer as ${seen.responseStatus}`);
    }
  },
};
