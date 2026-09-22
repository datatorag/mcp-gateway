/**
 * Lifecycle scenarios, one per service (SCRUM-303, revision 4).
 *
 * A tier said how EXPENSIVE a case was. It never said what the case was
 * for, so a red tier 2 named a number and a service and left the reader to
 * work out which step of which flow had broken.
 *
 * A scenario is the sequence a real user runs end to end, and every tool
 * the service ships is a step in it. Three things follow:
 *
 *  - a failure names the STEP, so the report reads "the doc was created and
 *    written and the read back came home empty" rather than "D4 failed";
 *  - `uncovered` stops meaning "nobody wrote a case" and starts meaning
 *    "the lifecycle forgot a tool", which is a claim about the product
 *    rather than about us;
 *  - somebody who does not read the suite can review it, because a scenario
 *    is just the flow.
 *
 * THE ORDER OF `steps` IS THE ORDER THEY RUN. It lives here rather than as
 * a number on each case, so the lifecycle is readable in one place and
 * cannot be reordered by editing a file nobody opened. `scenarios.test.ts`
 * asserts that every case belongs to exactly one scenario and that every id
 * named here exists, so the two cannot drift.
 *
 * NOTHING IS DISCARDED, and the regroup happens one scenario per commit.
 * Each of the 54 ported cases becomes a step, carrying its guards with it;
 * a guard is a step with an assertion, not a case of its own. Until the
 * move finishes, what is placed here and what is still in
 * `REGROUP_PENDING` below together are the whole suite, and the invariants
 * assert exactly that rather than trusting this comment.
 */

export const SCENARIO_KEYS = [
  "gateway",
  "sheets",
  "gmail",
  "docs",
  "drive",
  "calendar",
  "jira",
  "tasks",
  "contacts",
  "slides",
  "confluence",
  "skills",
] as const;

export type ScenarioKey = (typeof SCENARIO_KEYS)[number];

export type Scenario = {
  key: ScenarioKey;
  /** What the lifecycle IS, in the words a reviewer would use. */
  title: string;
  /**
   * True only where the scenario actually puts mail in someone's inbox.
   *
   * It drives the confirmation the UI shows, and it is deliberately ONE
   * scenario rather than a whole tier: the old dialog warned about sending
   * mail on runs that sent none, which is how a warning stops being read.
   *
   * Gmail is the only one today. It stops being the only one the moment
   * another scenario gains an attendee, a share or a comment step, and the
   * flag is per scenario so that change is a one-line fact rather than a
   * rethink.
   */
  sendsMail?: boolean;
  /** Case ids, IN THE ORDER THEY RUN. */
  steps: string[];
};

/**
 * ORDER MATTERS HERE TOO. Gateway leads because it is the handshake and the
 * registry agreement: when it is red, a later red is likely a consequence
 * of it rather than a finding of its own, so it is the one to read first.
 * The rest are in a deliberate order, not an alphabetical one. The basis
 * for it is recorded outside this repository, which is public.
 */
export const SCENARIOS: Scenario[] = [
  {
    key: "gateway",
    title: "the front door, the registry agreement, and the guards that are not a service",
    steps: [
      "A1", // health answers ok
      "A2", // a client completes a handshake and a tool answers
      "A3", // tools/list fits the per-identity formula
      "A4", // plugin, registry and served list agree by name
      "A5", // health reports the analytics guard
      "R1", // the /mcp front door over real HTTP
      "B1", // a stored token authenticates a call to each provider
      "B2", // the same tool answers differently for two accounts
      "GW1", // the connected accounts built-in answers for this identity
      "E5", // read-only annotations match the names
      "E8", // the served schema carries the registry's parameters
      "F1", // a write prompts for approval and a reviewed read does not
      "F2", // tools needing an unapproved scope are absent
      "F7", // a fabricated API key is refused with a usable challenge
      "R2", // a non-admin can neither see nor call the runner's tools
      "G1", // a read against something that does not exist names the cause
    ],
  },
  {
    key: "sheets",
    title: "create a spreadsheet, work in it, and take it away again",
    steps: [
      /* THE WRITE PATH RUNS ON A SPREADSHEET THIS SCENARIO CREATES, and the
       * standing fixture sheet is read-only (HQ, 2026-09-21). Every writer
       * used to work in the fixture's scratch tab, so a cleanup that failed
       * halfway damaged the artefact the read steps below, and two other
       * scenarios, depend on. SH1 opens it and SH5 closes it; the steps
       * between declare `needs: ["SH1"]`, so a failed create skips them
       * with a reason instead of failing each one separately against a
       * spreadsheet that does not exist. */
      "SH1", // create the spreadsheet this lifecycle works in
      "D7", //  add a tab, and it answers with a real sheet id
      "D1", //  append a row, read it back, clear it
      "E3", //  values beginning = and + are stored as text
      "E4", //  a leading zero and a leading plus survive the round trip
      "D2", //  update a cell and read the change back
      "SH2", // a batch applies both requests and replies in order
      "SH3", // format a table: header frozen, values untouched
      "D14", // a bold background reads back, and clears again
      "SH4", // a renamed tab drops its old name
      /* The read guards, which stay on the STANDING FIXTURE. They are about
       * values and shapes that only exist on a sheet nobody rewrites. */
      "C1", //  the fixture sheet reads back its exact control values
      "E11", // a range naming a missing tab names the tabs that do exist
      "E17", // many ranges answer in request order, duplicates and all
      "C12", // a query returns rows and refuses a column out of range
      "SH5", // delete the spreadsheet, and prove it is gone from Drive
    ],
  },
  {
    key: "gmail",
    title: "label it, draft it, send it, read it, reply, forward, file the attachment",
    /* THE ONLY SCENARIO THAT PUTS MAIL IN SOMEBODY'S INBOX, so it is the
     * only one whose confirmation says so. A tier-wide warning fired on
     * runs that sent nothing, which is how a warning stops being read.
     * Every send goes to the reader mailbox we own, carries the smoke
     * prefix and this run's stamp, and is trashed by `trashOwnMessage`,
     * which refuses any message whose subject does not carry that stamp. */
    sendsMail: true,
    steps: [
      /* Labels first: they are the cheapest thing to create and the only
       * part of this lifecycle that touches nothing else. */
      "E1", //  creating a label answers with its id, and it is removed again
      "GM1", // a renamed label drops its old name
      "E2", //  an account with no filters answers an empty list, not ""
      /* Drafts. D3's never leaves; E15's does, which makes E15 THE FIRST
       * STEP THAT SENDS, because sending a draft is still sending. */
      "D3", //  a draft is created, read back by id, and deleted
      "E15", // a draft is signed once on write and not again on send
      /* THE MESSAGE THE REST OF THE LIFECYCLE IS ABOUT. Three steps below
       * consume it, and they are exactly the three that declare
       * `needs: ["D10"]`: GM3 marks it, D12 replies to it, D13 forwards
       * it. The others send their own mail or act on what is already
       * there, so they do not wait for this one. */
      "D10", // a sent message arrives in the reader mailbox with its token
      "E13", // the signature is applied once, in the HTML part only
      "E14", // signature false suppresses it, and the send says so
      "D11", // a sent draft arrives and is gone from drafts
      /* Reading what is now there. */
      "C2", //  search returns a message with its headers populated
      "GM2", // listing is bounded, and a filter that matches nothing is empty
      "GM3", // marking read clears UNREAD, and unread restores it
      "E16", // three messages labelled in one call, and unlabelled together
      /* Answering it. */
      "D12", // a reply lands in the original's thread
      "D13", // a forward carries both the note and the original's token
      /* And taking something out of it. */
      "D15", // an attachment saved to Drive matches in size and md5
    ],
  },
  {
    key: "docs",
    title: "create a document, write it, edit it, read it back, delete it",
    steps: [
      /* D4 and E10 each create and delete their own document, so neither
       * depends on the other and neither touches the fixture doc. */
      "D4", //  created, written, read back, deleted
      "E10", // nested replaceAllText works; the flat shape is refused
      /* Read guards, on the standing fixture doc. */
      "C5", //  the fixture doc's first line is its control heading
      "E9", //  a partial read returns the slice and says the doc is longer
    ],
  },
  {
    key: "drive",
    title: "make a folder, copy a file into view, find it, read it",
    steps: [
      "DR1", // a folder is created inside the fixture folder, then removed
      "D9", //  a copy is renamed, found by its new name, and deleted
      "C4", //  search lists the fixture folder and the doc inside it
      "DR2", // reading the fixture doc returns the document's own text
    ],
  },
  {
    key: "calendar",
    title: "put something on the calendar, read it, change it, check the time is taken, remove it",
    steps: [
      /* D5 owns the whole create-list-delete arc on its own event, so it
       * runs first. C3 and CA1 then read the standing fixture, and CA2 and
       * CA3 each create, use and remove an event of their own. */
      "D5", //  a created event is listed, then deleted, and the listing loses it
      "C3", //  the permanent fixture event is listed in its window
      "CA1", // a get by id returns that event, with its control summary
      "CA2", // an update changes what a later get returns
      "CA3", // freebusy is busy where an event was made and free beside it
    ],
  },
  {
    key: "jira",
    title: "find the board, raise an issue, work it, comment on it, close it out",
    steps: [
      /* The two reads that need nothing created run first, so a failure in
       * them is the connector rather than anything this scenario did. */
      "C7",  // a bounded search returns issues from our own project
      "JR1", // the field catalogue answers with identified fields
      "JR2", // a user search answers with accounts carrying an account id
      "C11", // a created issue is deleted and it is the only thing that changed
      "JR3", // updating a summary changes what a later get returns
      "JR4", // a comment is added, edited and deleted, each seen by a re-read
      "JR5", // an issue transitions to a status the board offered
      "JR6", // the attachment endpoint agrees with the issue
      "JR7", // a delete is refused locally when the key is not a jira key
    ],
  },
  {
    key: "tasks",
    title: "see the lists, then make a task, rename it, finish it, remove it",
    steps: [
      "C10", // the first page of tasklists answers with a list shape
      "TK1", // a task is created, renamed, completed and deleted
    ],
  },
  {
    key: "contacts",
    title: "add somebody, correct the entry, look them up, remove them",
    steps: [
      "C9",  // the first page of contacts answers with a list shape
      "CO1", // a contact is created, renamed, deleted, and a later get refused
      "CO2", // a contact search answers addressably
      "CO3", // the org directory read answers addressably
    ],
  },
];

/**
 * Tools NOBODY WILL COVER, and why.
 *
 * An uncovered tool is normally a gap: a step the lifecycle forgot. A few
 * are decisions instead, and the two look identical in a run's output
 * unless the decision is written down. Without this, the reason lives in a
 * commit message nobody reads while looking at a red dashboard, and the
 * next person to notice the gap closes it by writing the case the reason
 * says not to write.
 *
 * An entry is a claim that covering the tool would be WORSE than not, and
 * it has to say why in terms a reader can check.
 */
export const UNCOVERED_ON_PURPOSE: Record<string, string> = {
  "gws-mcp__tasks_create_tasklist":
    "creates what the connector cannot delete: no tasks tool removes a tasklist, and gws_run is read-only for every service, so a case covering this would leave one list behind on every run",
};

/**
 * Cases regrouped into a scenario, one scenario per commit, in map order.
 *
 * Everything not yet placed is listed here rather than left to be noticed.
 * `scenarios.test.ts` asserts that placed and pending together are exactly
 * the registered cases, with no id in both and none in neither, so this
 * list cannot quietly go stale and a case cannot fall out of the suite
 * during the regroup. It shrinks to empty and then this constant goes.
 *
 * A pending case still RUNS: `CASES` is what "run everything" means. What
 * it cannot yet do is be selected by scenario, because it is not in one.
 */
export const REGROUP_PENDING: string[] = [
  // slides
  "C6", "D6",
  // confluence
  "C8",
  // skills
  "C13",
];

const BY_KEY = new Map(SCENARIOS.map((s) => [s.key, s]));

export function scenario(key: string): Scenario | undefined {
  return BY_KEY.get(key as ScenarioKey);
}

/** The scenario a case belongs to, or undefined while it is not yet placed. */
export function scenarioOf(caseId: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.steps.includes(caseId));
}

/** A case's 1-based position in its scenario, for the report. */
export function stepNumber(caseId: string): number | undefined {
  const s = scenarioOf(caseId);
  if (!s) return undefined;
  return s.steps.indexOf(caseId) + 1;
}
