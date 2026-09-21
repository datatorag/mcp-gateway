import type { TestCase } from "../types";
import { resultJson } from "../result-json";

type FreeBusy = {
  calendars?: Record<
    string,
    { busy?: { start?: string; end?: string }[]; errors?: { reason?: string }[] }
  >;
};

/**
 * CA3 (Calendar scenario): freebusy reports the calendar's actual busy time.
 *
 * TWO WINDOWS, because one proves nothing. Asserting that the window
 * holding a just-created event comes back busy passes against a handler
 * that reports busy for everything; asserting that an empty window comes
 * back free passes against one that reports free for everything. The claim
 * is the DIFFERENCE between them, over the same calendar, minutes apart.
 *
 * The busy window is this case's own created event rather than C3's
 * fixture: a fixture event could be marked transparent (shows as free) and
 * this case does not control that, so resting on it would make a correct
 * freebusy look broken.
 *
 * BOTH WINDOWS ARE PROVEN FREE FIRST. The control one rules out a handler
 * that answers busy for everything; the busy one rules out the case
 * mistaking somebody else's event, or its own residue, for the event it
 * just created.
 *
 * WHEN EITHER IS ALREADY OCCUPIED the case says so and names what to look
 * at. For the control that is usually the calendar, since an all-day or
 * recurring event can reach a window years out, though a constant-busy
 * handler lands in the same branch and the message says so rather than
 * ruling it out. For the busy window it is usually residue from a run whose
 * cleanup leaked.
 *
 * `emails` IS A COMMA-SEPARATED STRING, not an array. The handler calls
 * `.split(",")` on it, and an array never gets that far: the plugin checks
 * every call against the tool's own `inputSchema` at its boundary
 * (`validateArgs` in `src/tools/validate.ts`, called from
 * `src/create-server.ts` before the handler), so a non-string `emails` comes
 * back as an isError tool result naming the parameter, which `resultJson`
 * reports as the tool answering with an error.
 *
 * Two earlier versions of this comment each described a different wrong
 * mechanism, the second asserting the plugin validates nothing. That one was
 * a claim about a security boundary, made without reading the boundary.
 *
 * AN ASSUMPTION THIS CASE RESTS ON, named so a red points at the right
 * thing: the event is created on `calendar_id` default `"primary"`, and
 * freebusy is asked about the sender's ADDRESS. For an ordinary account
 * those are the same calendar. If they ever are not, the busy poll below
 * times out, and the honest reading of that timeout is "primary is not the
 * calendar this address names", not "freebusy is broken".
 */
export const ca3CalendarFreebusy: TestCase = {
  id: "CA3",
  title: "freebusy reports busy where an event was created and free in the window beside it",
  covers: [
    "gws-mcp__calendar_create_event",
    "gws-mcp__calendar_freebusy",
    "gws-mcp__calendar_delete_event",
  ],
  accounts: ["sender"],
  timeoutMs: 120_000,
  run: async (ctx) => {
    const busyStart = "2028-11-16T09:00:00-08:00";
    const busyEnd = "2028-11-16T09:30:00-08:00";
    /* The control: a LATER half hour on the same day and calendar, with a
     * gap rather than abutting the busy window, so a boundary rounded the
     * wrong way cannot make the two overlap. */
    const freeStart = "2028-11-16T11:00:00-08:00";
    const freeEnd = "2028-11-16T11:30:00-08:00";
    const who = ctx.address("sender");

    const askBusy = async (time_min: string, time_max: string) => {
      const res = resultJson<FreeBusy>(
        "calendar_freebusy",
        await ctx.call(
          "gws-mcp__calendar_freebusy",
          { time_min, time_max, emails: who },
          { as: "sender" }
        )
      );
      const forWho = res.calendars?.[who];
      if (!forWho) {
        throw new Error(
          `freebusy answered without an entry for the address it was asked about; it carries ${JSON.stringify(Object.keys(res.calendars ?? {}))}`
        );
      }
      /* AN ENTRY CARRYING ERRORS IS NOT AN EMPTY ONE. A freebusy entry that
       * could not be resolved carries `errors`, usually alongside an empty
       * `busy`, and reading only `busy` would let a window pass on absence
       * of evidence, and would surface later as a poll timeout blamed on
       * the primary-versus-address assumption. */
      if (forWho.errors?.length) {
        throw new Error(
          `freebusy could not answer about this calendar: ${forWho.errors.map((e) => e.reason ?? "unknown").join(", ")}`
        );
      }
      return forWho.busy ?? [];
    };

    /* THE CONTROL IS CHECKED FIRST, before anything is created. Checking it
     * afterwards could not tell a pre-existing conflict from one this case
     * had just made. */
    const controlBefore = await askBusy(freeStart, freeEnd);
    if (controlBefore.length > 0) {
      throw new Error(
        `the control window is already busy on this calendar (${controlBefore.length} interval(s)), so a busy answer cannot be told from a constant one; move this case's windows to a free day`
      );
    }
    /* AND THE BUSY WINDOW TOO, which the first version of this case did not
     * check. Without it, the interval the poll finds need not be this case's
     * event: a previous run whose cleanup left residue (`leaked` is a
     * supported outcome), or a transient retry, which re-runs the body with
     * the same context BEFORE any undo fires, both put an event in this
     * window already. The poll would then return on its first probe and the
     * case would pass while freebusy had stopped reflecting new writes. */
    const occupiedBefore = await askBusy(busyStart, busyEnd);
    if (occupiedBefore.length > 0) {
      throw new Error(
        `the window this case creates into is already busy (${occupiedBefore.length} interval(s)) before it has created anything, so a later busy answer would not be evidence of this run's event; the causes are a retry re-running this body after an earlier attempt already created, and residue from a run whose cleanup leaked`
      );
    }
    ctx.evidence("both windows are free before anything is created");

    const created = resultJson<{ id?: string }>(
      "calendar_create_event",
      await ctx.call(
        "gws-mcp__calendar_create_event",
        {
          summary: `[smoke] CA3 freebusy ${ctx.stamp}`,
          start: busyStart,
          end: busyEnd,
          description: "Created by the smoke suite to occupy a window, deleted in the same run.",
          send_updates: "none",
        },
        { as: "sender" }
      )
    );
    const event_id = created.id;
    if (!event_id) throw new Error("calendar_create_event returned no id, so nothing occupies the window");
    ctx.defer("delete the created event", async () => {
      await ctx.call(
        "gws-mcp__calendar_delete_event",
        { event_id, send_updates: "none" },
        { as: "sender" }
      );
    });

    // POLLED: freebusy is derived and does not always reflect a write the
    // instant it returns.
    const busy = await ctx.until(
      "the created event to show as busy",
      async () => {
        const intervals = await askBusy(busyStart, busyEnd);
        return intervals.length > 0 ? intervals : undefined;
      },
      { everyMs: 3_000, forMs: 60_000 }
    );
    ctx.evidence(`the occupied window reports ${busy.length} busy interval(s)`);

    const controlAfter = await askBusy(freeStart, freeEnd);
    if (controlAfter.length > 0) {
      throw new Error(
        "the control window became busy too, so freebusy is not answering about the window it was asked for"
      );
    }
    ctx.evidence("the control window is still free, so the busy answer tracks the window asked about");
  },
};
