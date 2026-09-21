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
];

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
  // gmail
  "C2", "D3", "D10", "D11", "D12", "D13", "D15", "E1", "E2", "E13", "E14", "E15", "E16",
  // docs
  "C5", "D4", "E9", "E10",
  // drive
  "C4", "D9",
  // calendar
  "C3", "D5",
  // jira
  "C7", "C11",
  // tasks
  "C10",
  // contacts
  "C9",
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
