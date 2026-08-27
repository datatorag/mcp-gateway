import { CircleCheckIcon, CircleMinusIcon } from "lucide-react";

/**
 * The full capability comparison against Claude's built-in Google connectors.
 *
 * THE ROWS AND THE PROSE ARE NOT THIS FILE'S TO INVENT. They are supplied, and
 * every cell was established by enumerating each connector's complete tool
 * surface on a stated date and, where a capability was contested, running the
 * operation. Nothing here is reasoned from documentation. If a row seems
 * obviously true and is not here, it has not been tested: ask, do not add it.
 *
 * The rules that govern the table, all of which survived a draft that broke
 * several of them:
 *
 * 1. CLAIM FROM THE ENUMERATED TOOL SURFACE, NEVER FROM A SCOPE. A scope is
 *    inferred, invisible from outside, and changes without announcement. The
 *    public issue documenting one connector's missing scope also lists a
 *    capability as granted that the connector exposes no tool for. Scope does
 *    not predict capability in either direction.
 *
 * 2. STALE BY DEFAULT, NOT TRUE BY DEFAULT. This is a claim about someone
 *    else's moving product, so the verified-on date is rendered, not just
 *    recorded. Once it is more than a quarter old this section is a liability
 *    rather than an asset.
 *
 * 3. CONCEDE GENEROUSLY, AND DO NOT TRIM THE CONCESSIONS. The Drive group is
 *    the most credible thing on the page precisely because we lose it five
 *    rows to one. A reader who sees that believes the Sheets rows. A table
 *    that wins everything reads as an ad and gets discounted whole.
 *
 * 4. CALENDAR IS NOT A TIE. IT IS FOUR CONCESSIONS. This section called it
 *    parity until 10 August 2026, and that was wrong in the built-in
 *    connector's favour: it does rich event creation, RSVP, meeting-time
 *    suggestions and calendar listing, and we do none of those. We DO search
 *    events - calendar_list_events takes a `query` that reaches the API as
 *    `q` - and an earlier draft of this correction conceded that row by
 *    mistake. Check our own column against the registry before conceding it;
 *    a wrong concession is as disprovable as a wrong boast. The rule the old
 *    note was reaching for still holds and is why the correction went the way
 *    it did: a claim anyone can disprove by testing retroactively discredits
 *    every row that is true.
 *
 * 5. NAME SERVICES, NEVER COUNTS. Every hard-coded tool count we have shipped
 *    went stale without anyone touching it.
 *
 * 6. THERE ARE THREE BUILT-IN CONNECTORS: Drive, Gmail and Calendar. Sheets,
 *    Docs and Slides have no connector of their own and come through Drive.
 *    The groups below are named by service because that is how a reader thinks
 *    about them, and the notes carry the correction.
 *
 * 7. OUR OWN COLUMN NEEDS THE SAME EVIDENCE AS THEIRS, AND A TICK MEANS LIVE.
 *    Not "exists in the repo" — a tool that has been pushed but not rolled out
 *    with tool re-discovery is invisible to every user, so it is not a Yes
 *    here. An earlier draft of this file asserted "copy a file" and "file
 *    metadata" for us; we ship neither, and it also called free/busy a tie
 *    when it is ours alone. Guessing about our own side is the same failure as
 *    guessing about theirs and is easier to make, because it does not feel
 *    like a claim.
 *
 *    A capability reachable only through the generic API-passthrough tool is
 *    also not a Yes. That tool can reach anything, so counting it would make
 *    every row Yes and the table meaningless.
 */

/** Rendered, not just recorded. See rule 2. Change it only when the rows have
 * actually been retested. */
const VERIFIED_ON = "7 August 2026";
/** The Calendar rows were re-checked separately and later, and the standfirst
 * says so rather than moving the sitewide date: claiming the whole table was
 * re-verified when only one section was would be the same kind of overclaim
 * the correction exists to remove. */
const CALENDAR_VERIFIED_ON = "10 August 2026";

type Row = {
  capability: string;
  builtIn: boolean;
  ours: boolean;
  /** Draws the eye to the rows the section exists for. Used sparingly. */
  emphasis?: boolean;
};

type Group = {
  service: string;
  rows: Row[];
  /** The line that makes the group's rows mean something. Not decoration. */
  /** One paragraph, or several. Arrays render as separate paragraphs; a plain
   * string stays a single one, so existing entries are untouched. */
  note?: string | string[];
};

const GROUPS: Group[] = [
  {
    service: "Google Sheets",
    rows: [
      { capability: "Read a sheet", builtIn: true, ours: true },
      { capability: "Create a new sheet", builtIn: true, ours: true },
      { capability: "Update a cell", builtIn: false, ours: true, emphasis: true },
      { capability: "Append a row", builtIn: false, ours: true, emphasis: true },
      { capability: "Add, rename or delete a tab", builtIn: false, ours: true },
      { capability: "Clear a range", builtIn: false, ours: true },
    ],
    note: "Spreadsheets have no connector of their own. They come through Drive, and the Drive connector ships no update tool of any kind, for any file type.",
  },
  {
    service: "Google Docs",
    rows: [
      { capability: "Read a doc", builtIn: true, ours: true },
      { capability: "Create a new doc", builtIn: true, ours: true },
      { capability: "Edit an existing doc", builtIn: false, ours: true, emphasis: true },
      { capability: "Delete a doc", builtIn: false, ours: true },
    ],
    note: "Asked to fix a typo, the built-in connector reads the document, tells you what is wrong, and creates a new file with the correction. The original is untouched.",
  },
  {
    service: "Google Slides",
    rows: [
      { capability: "Create a deck", builtIn: true, ours: true, emphasis: true },
      { capability: "Put content in it", builtIn: false, ours: true, emphasis: true },
      { capability: "Read an existing deck", builtIn: true, ours: true },
    ],
    note: "This one surprised us. The built-in connector does make a real Google Slides deck. It just arrives with one blank slide, an empty title and an empty subtitle, because creating a file with content is refused. You get the container and you fill it in yourself.",
  },
  {
    service: "Gmail",
    rows: [
      { capability: "Read and search mail", builtIn: true, ours: true },
      { capability: "Write a draft", builtIn: true, ours: true },
      { capability: "Send it", builtIn: false, ours: true, emphasis: true },
      { capability: "Reply in thread", builtIn: false, ours: true, emphasis: true },
      { capability: "Forward", builtIn: false, ours: true, emphasis: true },
      { capability: "Label, star, mark read, archive a message", builtIn: true, ours: true },
      {
        capability: "Label or unlabel a whole thread at once",
        builtIn: true,
        ours: false,
        emphasis: true,
      },
      { capability: "Delete a draft", builtIn: false, ours: true },
      { capability: "Save an attachment to Drive", builtIn: false, ours: true },
    ],
    note: "The built-in connector creates drafts it can neither send nor delete. It also files a whole thread in one call, where we work a message at a time, so a long thread means one call per message. It gained full label management recently, so it can label, star, mark read and archive, which it could not do earlier this year. If you read otherwise somewhere, including on this site before August 2026, that is out of date.",
  },
  {
    service: "Google Calendar",
    rows: [
      { capability: "Read and list events", builtIn: true, ours: true },
      { capability: "Create, update, delete an event", builtIn: true, ours: true },
      {
        capability:
          "Rich event creation: recurrence, rooms, attachments, reminders",
        builtIn: true,
        ours: false,
        emphasis: true,
      },
      { capability: "RSVP to an invitation", builtIn: true, ours: false, emphasis: true },
      { capability: "Suggest a meeting time", builtIn: true, ours: false, emphasis: true },
      { capability: "Search events by keyword", builtIn: true, ours: true },
      { capability: "List your other calendars", builtIn: true, ours: false, emphasis: true },
      { capability: "Free/busy lookup", builtIn: false, ours: true },
    ],
    note: [
      "On a single account, the built-in connector is the better calendar tool, and it isn't close. Its event creation does recurring events, room booking, attachments, and custom reminders, where ours creates plain events. It can RSVP and suggest meeting times, and list the other calendars on the account. Ours can't.",
      "What we add is span: both your calendars reachable in one request, without either account having to share anything with the other. Free/busy runs one lookup per account and the assistant combines them.",
      "One honest caveat: the built-in connector sees every calendar the connected account can see. If you already share your personal calendar with your work account, that covers the cross-account case for you. Our advantage is for calendars you'd rather not share.",
    ],
  },
  {
    service: "Google Drive",
    rows: [
      { capability: "Search files", builtIn: true, ours: true },
      { capability: "Read file content", builtIn: true, ours: true },
      { capability: "Download file content", builtIn: true, ours: false, emphasis: true },
      { capability: "File metadata", builtIn: true, ours: false, emphasis: true },
      { capability: "Sharing permissions", builtIn: true, ours: false, emphasis: true },
      { capability: "Recently-opened files", builtIn: true, ours: false, emphasis: true },
      { capability: "Copy a file", builtIn: true, ours: false, emphasis: true },
      { capability: "Create a folder", builtIn: false, ours: true },
    ],
    note: "The built-in Drive connector is more capable than ours, and it is not close. Five things it does that we do not. Our advantage was never Drive breadth. It is that we can change the files Drive gives you access to.",
  },
  {
    service: "Beyond Google",
    rows: [
      { capability: "Google Contacts", builtIn: false, ours: true },
      { capability: "Google Tasks", builtIn: false, ours: true },
      { capability: "Jira, read, create, comment, transition", builtIn: false, ours: true },
      { capability: "Confluence, read, create, edit pages", builtIn: false, ours: true },
    ],
  },
  {
    service: "The one that changes how you work",
    rows: [
      {
        capability: "Work and personal account at the same time",
        builtIn: false,
        ours: true,
        emphasis: true,
      },
    ],
    note: "The built-in connectors handle one Google account. If you live in a work inbox and a personal one, you disconnect and reconnect to switch. Every DataToRAG tool takes an account, so checking both inboxes is one request.",
  },
];

const Mark = ({ yes }: { yes: boolean }) =>
  yes ? (
    <>
      <CircleCheckIcon aria-hidden="true" className="inline-block size-4 text-primary" />
      <span className="sr-only">Yes</span>
    </>
  ) : (
    <>
      <CircleMinusIcon
        aria-hidden="true"
        className="inline-block size-4 text-muted-foreground/40"
      />
      <span className="sr-only">No</span>
    </>
  );

export function ConnectorComparison() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-20">
      <div className="text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-primary">
          Full comparison
        </p>
        <h2 className="mt-3 font-display text-2xl font-bold text-foreground sm:text-3xl">
          What each one can actually do
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-muted-foreground">
          Claude&rsquo;s built-in connectors are good, and for a lot of people
          they&rsquo;re enough. We&rsquo;d rather you knew exactly where they stop
          than found out halfway through a task.
        </p>
        <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
          Everything below was checked by hand against both products on{" "}
          {VERIFIED_ON}. Calendar section re-verified {CALENDAR_VERIFIED_ON}.
        </p>
      </div>

      {/* `main` is `overflow-x-hidden`, so a wide table clips instead of
          scrolling. This wrapper is what lets it scroll on a narrow screen.

          `relative` is load-bearing and is NOT decoration. `overflow-x-auto`
          alone does not contain the `sr-only` spans in the cells below:
          `sr-only` is `position: absolute`, and with no positioned ancestor
          its containing block was the initial containing block, not this
          wrapper. An absolutely positioned box whose containing block sits
          outside an overflow ancestor is not clipped by it, so those spans
          escaped this scroller, landed at the table's own 480px width, and
          widened the whole document — the same escape that `position: fixed`
          makes, which is easy to miss because the element is invisible.

          Measured before the fix: 40 spans at right 456. On a real 445px
          window that made the document 456 wide and horizontally pannable by
          11px; at a 390 viewport it overhung by 66. Panning a document wider
          than the viewport is what shows page background beside a full-bleed
          band. Removing `relative` brings that straight back. */}
      <div className="relative mt-12 overflow-x-auto">
        {/* NO min-width below `sm`. The table used to be `min-w-[30rem]` (480px)
            at every width, against a 342px wrapper on a 390px phone. Measured
            before this change: Capability 100% visible, Built-in 77%,
            DataToRAG 0% — the COMPETITOR column was the one on screen and ours
            was entirely off it, on the table whose whole job is the comparison.
            The scroll existed, but a reader has to discover it, and the default
            view argued against us.

            Below `sm` the table fits the wrapper and both value columns are
            visible without scrolling; the capability label wraps instead, which
            it can afford (longest is 27 characters). The 480px floor is kept
            from `sm` up, where it fits comfortably. */}
        <table className="w-full border-collapse text-left text-sm sm:min-w-[30rem]">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
              <th className="py-3 pr-4 font-medium" scope="col">
                <span className="sr-only">Capability</span>
              </th>
              <th className="w-20 px-1 py-3 text-center font-medium sm:w-28 sm:px-2" scope="col">
                Built-in
              </th>
              <th className="w-20 px-1 py-3 text-center font-medium text-primary sm:w-28 sm:px-2" scope="col">
                DataToRAG
              </th>
            </tr>
          </thead>
          {GROUPS.map((group) => (
            <tbody key={group.service}>
              <tr>
                <th
                  className="pb-2 pt-9 text-left font-display text-base font-bold text-foreground"
                  colSpan={3}
                  scope="colgroup"
                >
                  {group.service}
                </th>
              </tr>
              {/* The column labels REPEATED under every service heading.
                  The table is 58 rows across nine services, so the real
                  header at the top is off screen for almost all of it, and a
                  reader partway down has two unlabelled columns of ticks and
                  has to remember which side is ours. Worse on mobile, where
                  the viewport shows a handful of rows at a time.

                  aria-hidden because these are a VISUAL aid only: the thead
                  above already associates every cell with its column for a
                  screen reader, and announcing the same two labels nine more
                  times would be noise, not help. */}
              <tr
                aria-hidden="true"
                className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground"
              >
                <td className="py-2 pr-4" />
                <td className="px-1 py-2 text-center font-medium sm:px-2">
                  Built-in
                </td>
                <td className="px-1 py-2 text-center font-medium text-primary sm:px-2">
                  DataToRAG
                </td>
              </tr>
              {group.rows.map((row) => (
                <tr className="border-b border-border/60" key={row.capability}>
                  <th
                    className={`py-3 pr-4 text-left ${
                      row.emphasis
                        ? "font-semibold text-foreground"
                        : "font-normal text-foreground/90"
                    }`}
                    scope="row"
                  >
                    {row.capability}
                  </th>
                  <td className="px-1 py-3 text-center sm:px-2">
                    <Mark yes={row.builtIn} />
                  </td>
                  <td className="px-1 py-3 text-center sm:px-2">
                    <Mark yes={row.ours} />
                  </td>
                </tr>
              ))}
              {group.note ? (
                <tr>
                  <td
                    className="pb-1 pt-3 text-sm leading-relaxed text-muted-foreground"
                    colSpan={3}
                  >
                    {Array.isArray(group.note)
                      ? group.note.map((para, i) => (
                          <p className={i > 0 ? "mt-2" : undefined} key={i}>
                            {para}
                          </p>
                        ))
                      : group.note}
                  </td>
                </tr>
              ) : null}
            </tbody>
          ))}
        </table>
      </div>

      <p className="mt-14 border-t border-border pt-8 text-center text-base text-foreground">
        <strong className="font-semibold">
          If you mostly read, the built-in connectors are free and they&rsquo;re
          good, so use them.
        </strong>{" "}
        <span className="text-muted-foreground">
          The moment you need Claude to change something that already exists, or
          to work across more than one account, that is where we start.
        </span>
      </p>
    </div>
  );
}
