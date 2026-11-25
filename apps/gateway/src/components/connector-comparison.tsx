import { CircleCheckIcon, CircleMinusIcon } from "lucide-react";
import { BUILT_IN_CHECKED_ON, BUILT_IN_HELP_URL } from "@/lib/connector-verification";
import { BUILT_IN_DIFFERENCE } from "@/lib/site-faq";

/**
 * The comparison against Claude's built-in Google connectors.
 *
 * THE BUILT-IN COLUMN IS ANTHROPIC'S HELP PAGE, AND NOTHING ELSE. Until
 * November 25, 2026 every cell came from our own enumeration of the
 * connectors' tool lists. That could not be shown to a reader, and it went
 * stale without anyone touching it: this table said a built-in Slides deck
 * arrived empty and that Docs and Sheets editing was in beta after the
 * vendor's own page said otherwise. The rules now:
 *
 * 1. A BUILT-IN CELL SAYS ONLY WHAT THE VENDOR'S PAGE SAYS, ON THE DATE IN
 *    BUILT_IN_CHECKED_ON, NO MORE STRONGLY THAN THE PAGE. `builtIn: true`
 *    means the page (BUILT_IN_HELP_URL) describes it. `builtIn: false` means
 *    the page does not describe it, and renders as "Not described". It never
 *    means the connectors cannot do it: a page being silent is not the vendor
 *    stating a limit. The one limit the page states for a file type (no
 *    charts in Slides) is quoted in that group's note.
 *
 * 2. A ROW EXISTS ONLY IF THE PAGE SPEAKS TO IT, OR IF IT IS SOMETHING OF
 *    OURS WORTH A "NOT DESCRIBED" CELL. A capability both products may well
 *    have, which the page happens not to list (copy a file, trash a message),
 *    gets no row: a "Not described" cell beside our tick would read as a gap
 *    we cannot show. The notes name what was left out and why.
 *
 * 3. STALE BY DEFAULT, NOT TRUE BY DEFAULT. This is a claim about someone
 *    else's moving product, so the date is rendered in the table's caption
 *    and in every note, from the one constant. Re-read the page before moving
 *    the date.
 *
 * 4. CONCEDE GENEROUSLY, AND DO NOT TRIM THE CONCESSIONS. Most rows are ties,
 *    and the recurring-meeting row is theirs. A table that wins everything
 *    reads as an ad and gets discounted whole.
 *
 * 5. NAME SERVICES, NEVER COUNTS. Every hard-coded tool count we have shipped
 *    went stale without anyone touching it.
 *
 * 6. GOOGLE ONLY. The page this rests on covers Claude's Google connectors.
 *    Jira, Confluence, and Notion are on our address, and the table makes no
 *    comparison for them; rows that did were removed with the enumeration
 *    they rested on. Before a comparison for another service comes back, read
 *    that vendor's page and date it the same way.
 *
 * 7. OUR OWN COLUMN NEEDS THE SAME EVIDENCE AS THEIRS, AND A TICK MEANS LIVE.
 *    Each `ours: true` is a tool on a docs page under content/docs. A
 *    capability reachable only through the generic API-passthrough tool is
 *    not a Yes: that tool can reach anything, so counting it would make every
 *    row Yes and the table meaningless.
 */

type Row = {
  capability: string;
  /** A shorter name for the hero's "Both:" line only; the full table always
   * shows `capability`. A shortening, never a new claim. A Yes/Yes row
   * without one falls back to its full label. */
  short?: string;
  /** true: Anthropic's help page describes it as of BUILT_IN_CHECKED_ON.
   * false: the page does not describe it ("Not described"), which is NOT a
   * statement that the connectors cannot do it. See rule 1. */
  builtIn: boolean;
  ours: boolean;
  /** Draws the eye to the rows the section exists for. Used sparingly. */
  emphasis?: boolean;
};

type Group = {
  service: string;
  rows: Row[];
  /** The line that makes the group's rows mean something. Not decoration.
   * One paragraph, or several. Arrays render as separate paragraphs. */
  note?: string | string[];
};

/** How a note opens its sentence about the vendor's page. */
const PAGE = `As of ${BUILT_IN_CHECKED_ON}, Anthropic's help page`;

export const GROUPS: Group[] = [
  {
    service: "Google Sheets",
    rows: [
      // "Read Sheets, Slides, PDFs, images, and MS Office files."
      { capability: "Read a sheet", short: "read", builtIn: true, ours: true },
      // "Create new Google Docs, Sheets, and Slides files."
      { capability: "Create a new sheet", short: "create", builtIn: true, ours: true },
      // "Claude can edit Google Docs, Sheets, and Slides live in a pane
      // beside the chat." The page lists no operations, so this is one row
      // where there were five (update a cell, append a row, tabs, clear a
      // range, format).
      { capability: "Edit an existing sheet", short: "edit", builtIn: true, ours: true },
      // Ours: sheets_query (docs/sheets). The page describes no query.
      { capability: "Query a sheet with a filter", builtIn: false, ours: true, emphasis: true },
    ],
    note: `${PAGE} says Claude can read Sheets, create new Sheets files, and edit them live in a pane beside the chat. It does not list what an edit covers, so the table has one edit row. DataToRAG updates cells, appends rows, manages tabs, clears ranges, and formats, and it runs a query in the QUERY() language over a range. The page does not describe a query.`,
  },
  {
    service: "Google Docs",
    rows: [
      // "Search and retrieve Google Docs from your Drive."
      { capability: "Read a doc", short: "read", builtIn: true, ours: true },
      { capability: "Create a new doc", short: "create", builtIn: true, ours: true },
      { capability: "Edit an existing doc", short: "edit", builtIn: true, ours: true },
      // "Share, move, and trash files in Google Drive." Ours deletes.
      { capability: "Delete or trash a doc", short: "trash", builtIn: true, ours: true },
    ],
    note: `${PAGE} says Claude can retrieve Google Docs, create new ones, and edit them live, and that it can read and work with comments and suggestions in Google Docs.`,
  },
  {
    service: "Google Slides",
    rows: [
      { capability: "Create a deck", short: "create", builtIn: true, ours: true },
      // Replaced "Put content in it", which said No for built-in until
      // November 25, 2026. The page says Claude edits Slides.
      { capability: "Edit an existing deck", short: "edit", builtIn: true, ours: true },
      { capability: "Read an existing deck", short: "read", builtIn: true, ours: true },
    ],
    note: `${PAGE} says Claude can read Slides, create new Slides files, and edit them. The limits it lists are that Claude can't add charts to Google Slides and that Slides edits may not appear live in the pane. This group said a built-in deck arrived empty until ${BUILT_IN_CHECKED_ON}. The page says otherwise, and that row is gone.`,
  },
  {
    service: "Gmail",
    rows: [
      // "Search and read emails using natural language queries"
      { capability: "Read and search mail", short: "read and search", builtIn: true, ours: true },
      // "Draft emails", "List saved drafts"
      { capability: "Write a draft", short: "drafts", builtIn: true, ours: true },
      { capability: "List saved drafts", short: "list drafts", builtIn: true, ours: true },
      // "Send, reply to, and forward emails from Gmail."
      { capability: "Send it", short: "send", builtIn: true, ours: true },
      { capability: "Reply in thread", short: "reply", builtIn: true, ours: true },
      { capability: "Forward", short: "forward", builtIn: true, ours: true },
      // "Manage email organization with labels and threads". One row where
      // there were two; star, mark read and archive are not on the page.
      { capability: "Organize mail with labels", short: "labels", builtIn: true, ours: true },
      // "Open email attachments so Claude can read or work with the file,
      // up to about 12 MB each." Ours: gmail_get_attachment (docs/gmail).
      { capability: "Open an email attachment", short: "open attachments", builtIn: true, ours: true },
      // Ours: gmail_save_attachment_to_drive and drive_upload_file, and
      // file_download_link (docs/gmail, docs/file-references). The page
      // describes neither.
      { capability: "Save an email or an attachment to Drive", builtIn: false, ours: true },
      { capability: "Save an email or an attachment to your computer", builtIn: false, ours: true },
    ],
    note: `${PAGE} says Claude can search and read mail, draft, send, reply to, and forward email, open attachments up to about 12 MB each, manage labels and threads, and list saved drafts. It does not describe saving an email or an attachment to Drive or to your computer, which DataToRAG does. DataToRAG also trashes messages, marks spam, and deletes drafts. The page does not mention those either way, so they have no row.`,
  },
  {
    service: "Google Calendar",
    rows: [
      // "View events and calendars, including shared calendars you have
      // access to"
      { capability: "Read and list events", short: "read and list", builtIn: true, ours: true },
      // "Create, update, and delete events with full customization"
      { capability: "Create, update, delete an event", short: "create, update, delete", builtIn: true, ours: true },
      // "Set up recurring meetings". calendar_create_event has no
      // recurrence option, so this row is theirs.
      { capability: "Set up a recurring meeting", builtIn: true, ours: false, emphasis: true },
      // "respond to invitations (accept, decline, or tentative)"
      { capability: "RSVP to an invitation", short: "RSVP", builtIn: true, ours: true },
      // "Find mutual availability across attendees". Ours:
      // calendar_suggest_time and calendar_freebusy. A separate free/busy
      // row said No for built-in until November 25, 2026; the page
      // describes the job that row was about, so it is folded in here.
      { capability: "Find a time across attendees' availability", short: "find a time", builtIn: true, ours: true },
      { capability: "See your other calendars", short: "list calendars", builtIn: true, ours: true },
    ],
    note: [
      `${PAGE} says Claude can view events and calendars, create, update, and delete events with full customization, find mutual availability across attendees, respond to invitations, and set up recurring meetings. DataToRAG creates plain events with attendees, a location, and a Meet link, and has no recurrence option, so that row is theirs.`,
      "What DataToRAG adds is span: the calendars of more than one Google account behind one connection, one call per account, without either account having to share anything with the other.",
      "One honest caveat: the help page says the built-in connector views shared calendars you have access to. If you already share your personal calendar with your work account, that may cover the cross-account case for you.",
    ],
  },
  {
    service: "Google Drive",
    rows: [
      { capability: "Search files", short: "search", builtIn: true, ours: true },
      { capability: "Read file content", short: "read", builtIn: true, ours: true },
      // "Look up file metadata"
      { capability: "File metadata", short: "metadata", builtIn: true, ours: true },
      // "View file permissions and list recent changes to your Drive."
      { capability: "Sharing permissions", short: "permissions", builtIn: true, ours: true },
      { capability: "Recent files", short: "recent files", builtIn: true, ours: true },
      // "Share, move, and trash files in Google Drive."
      { capability: "Share a file with someone", short: "share", builtIn: true, ours: true },
      { capability: "Move a file to another folder", short: "move", builtIn: true, ours: true },
      { capability: "Trash a file", short: "trash", builtIn: true, ours: true },
      // "Upload any file type, with optional auto-convert to Google formats."
      { capability: "Upload a file", short: "upload", builtIn: true, ours: true },
      // "Create folders."
      { capability: "Create a folder", short: "folders", builtIn: true, ours: true },
    ],
    note: `${PAGE} says Claude can search and read files, look up metadata, view permissions, share, move, and trash files, upload any file type, create folders, and list recent changes. DataToRAG does each of those. It also copies and renames files and makes a single-use download link with a checksum. The page does not mention those either way, so they have no row. Drive breadth is not the difference between the two.`,
  },
  {
    service: "Contacts and Tasks",
    rows: [
      // Ours: docs/contacts and docs/tasks.
      { capability: "Google Contacts", builtIn: false, ours: true },
      { capability: "Google Tasks", builtIn: false, ours: true },
    ],
    note: `${PAGE} does not describe a Contacts or a Tasks connector. That is the page being silent, not Anthropic stating a limit. DataToRAG has tools for both. Jira, Confluence, and Notion are on the same DataToRAG address too. This table compares Google only and makes no comparison for them.`,
  },
  {
    service: "More than one Google account",
    rows: [
      // Ours: docs/multiple-accounts, the `account` argument.
      {
        capability: "Several Google accounts behind one connection",
        builtIn: false,
        ours: true,
        emphasis: true,
      },
    ],
    note: `Every DataToRAG Google tool takes an optional account, so a work account and a personal account answer the same prompt, one call per account. ${PAGE} does not describe connecting more than one Google account.`,
  },
];

/** The rows the landing page's hero shows: every row of the table above that
 * we have and Anthropic's help page does not describe, and nothing else. The
 * filter decides WHICH rows; the map below only decides WHERE each one sits.
 * Text is never retyped, so a row changed in GROUPS changes the hero on the
 * same deploy.
 *
 * A hero row the map does not name is not shown, and a test fails on it
 * (`unmappedHeroGaps`), so a future row of this kind cannot drop out
 * silently. A row the map names that the page now describes is simply
 * absent, which is how a tie leaves the hero.
 *
 * TIES: under its rows, each hero group carries one line of what both do, the
 * Yes/Yes rows of the source groups named in `tiesFrom`, in the full table's
 * order. Rows where the built-in connectors do more (built-in Yes, ours No)
 * appear nowhere in the hero; they stay conceded in the full table. */
export type HeroRow = Row;
export type HeroGroup = { label: string; rows: HeroRow[]; ties: string[] };

const HERO_MAP: { label: string; rows: string[]; tiesFrom: string[] }[] = [
  {
    label: "Sheets",
    rows: ["Query a sheet with a filter"],
    tiesFrom: ["Google Sheets"],
  },
  {
    label: "Gmail attachments",
    tiesFrom: ["Gmail"],
    rows: [
      "Save an email or an attachment to Drive",
      "Save an email or an attachment to your computer",
    ],
  },
  {
    label: "Contacts, Tasks, and accounts",
    rows: ["Google Contacts", "Google Tasks", "Several Google accounts behind one connection"],
    tiesFrom: [],
  },
];

/** Every row we have and the help page does not describe. */
function heroGaps(groups: Group[]) {
  return groups.flatMap((g) => g.rows.filter((r) => !r.builtIn && r.ours));
}

/** Hero rows the map does not place. Must be empty; a test holds it. */
export function unmappedHeroGaps(groups: Group[] = GROUPS): string[] {
  const placed = new Set(HERO_MAP.flatMap((g) => g.rows));
  return heroGaps(groups)
    .map((r) => r.capability)
    .filter((c) => !placed.has(c));
}

export function heroGroups(groups: Group[] = GROUPS): HeroGroup[] {
  const gaps = new Map(heroGaps(groups).map((r) => [r.capability, r]));
  return HERO_MAP.map(({ label, rows, tiesFrom }) => ({
    label,
    rows: rows.flatMap((capability) => {
      const gap = gaps.get(capability);
      return gap ? [gap] : [];
    }),
    ties: tiesFrom.flatMap((service) =>
      (groups.find((g) => g.service === service)?.rows ?? [])
        .filter((r) => r.builtIn && r.ours)
        .map((r) => r.short ?? r.capability)
    ),
  })).filter((g) => g.rows.length > 0);
}

/** What a built-in cell says when the help page does not describe the row.
 * Words, not a mark: a minus sign reads as "cannot", which the page never
 * said. The hero prints the same words from here. */
export const NOT_DESCRIBED = "Not described";
export const NOT_DESCRIBED_SUFFIX = " on Anthropic's help page";

const Yes = () => (
  <>
    <CircleCheckIcon aria-hidden="true" className="inline-block size-4 text-primary" />
    <span className="sr-only">Yes</span>
  </>
);

/** The built-in column: a tick when the page describes it, the words when it
 * does not. */
const BuiltInMark = ({ described }: { described: boolean }) =>
  described ? (
    <Yes />
  ) : (
    <span className="text-[11px] leading-tight text-muted-foreground">
      {NOT_DESCRIBED}
      <span className="sr-only">{NOT_DESCRIBED_SUFFIX}</span>
    </span>
  );

/** Our own column, where No is ours to say. */
const Mark = ({ yes }: { yes: boolean }) =>
  yes ? (
    <Yes />
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
          DataToRAG reaches several Google accounts through one connection,
          has Google Contacts and Google Tasks tools, puts Jira, Confluence,
          and Notion on the same address, and works from any MCP client.
          Claude&rsquo;s built-in Google connectors read, create, and edit
          Docs, Sheets, and Slides files and send email, so most rows below
          are ties.
        </p>
        <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
          The Built-in column is what{" "}
          <a
            className="underline underline-offset-4 hover:text-foreground"
            href={BUILT_IN_HELP_URL}
            rel="noopener noreferrer"
            target="_blank"
          >
            Anthropic&rsquo;s help page
          </a>{" "}
          says as of {BUILT_IN_CHECKED_ON}, and nothing more. A tick means the
          page describes it. &ldquo;{NOT_DESCRIBED}&rdquo; means the page does
          not mention it, which is not the same as Claude being unable to do
          it. The DataToRAG column is our own tool list.
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
          <caption className="sr-only">
            Claude&rsquo;s built-in Google connectors as Anthropic&rsquo;s help
            page describes them as of {BUILT_IN_CHECKED_ON}, beside DataToRAG
          </caption>
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
                  The table is long, across eight groups, so the real
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
                    <BuiltInMark described={row.builtIn} />
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
        <strong className="font-semibold">{BUILT_IN_DIFFERENCE.close}</strong>{" "}
        <span className="text-muted-foreground">
          DataToRAG is for more than one Google account, Contacts and Tasks,
          Jira, Confluence, and Notion on the same address, and clients other
          than Claude.
        </span>
      </p>
    </div>
  );
}
