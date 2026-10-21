# Public status page from the daily test run (SCRUM-431)

Date: 2026-10-20. Status: spec, for review before any build. The plan is
`docs/plans/2026-10-20-scrum-431-public-status-page.md`.

## Ask

A public, read-only page at `/status` that shows what the end-to-end test
run found on production, so it does two jobs at once: it says whether the
product works right now, and its list of passing cases reads as a list of
what a user can do, each with proof.

It is not a pinger. The runner (SCRUM-303) calls every tool the way a user
does, against real accounts, so its result is the status.

## Source of truth

Two tables, `test_runs` and `test_results` (`packages/db/src/schema`). The
page types nothing by hand about the product's state; it is a view of those
rows joined to the case registry in code.

**Which run.** The newest run that is all of these:

- `environment = 'prod'`;
- `status = 'finished'` (not `running`, `aborted` or `interrupted`);
- `imported_from IS NULL` (an imported run is another environment's copy);
- **full scope**, `scope = '{}'`. A run's `scope` records what it was asked
  for, and a scoped run is common: a single case rerun after a fix, or one
  scenario. The newest finished prod run is often one of those, and a page
  built from it would show one case. Only a full run describes the product.

The lookup uses `test_runs_started_at_idx`. If nothing qualifies, the page
says that no full check has run yet and shows no statuses.

**Titles and surfaces come from code, not from the run.** `test_results`
holds a case id, a kind, a status, a duration, evidence and a cleanup state;
it has no title. The title is the case's own (`CASES` in
`apps/gateway/src/gateway/tests/cases`), and the surface is the case's
scenario (`scenarios.ts`). The two are joined by case id at render time.

- A case in the run but no longer in the code (retired since the run) is
  left out of the per-case list, and only its count is shown under the
  run's totals ("2 checks in this run have since been retired"). Its verdict
  still counts in the totals, so the numbers agree with the run.
- A case in the code but not in the run (added since) is not shown. The page
  shows what was checked, never what would have been.

## What the page shows

**Header.**
- When the run started (UTC, and relative: "6 hours ago"), how long it took,
  and the short gateway sha and plugin shas.
- The run's counts, by kind: the cases passed, failing and not run, and
  the tools working, failing and served but not exercised.
  - These are computed from the rendered rows, not copied from `totals`, so
    the page cannot disagree with itself.
  - Split by kind, because `totals` mixes them: `b7ceb0f4`'s 242 passes are
    the cases plus each served tool's contract probe.
  - Admin-only tools are left out of the counts as well as the lists.
- The cleanup state as one line: clean, or "left residue" when any result
  was `leaked`.

**By surface**, in a fixed order: Gmail, Calendar, Drive, Docs, Sheets,
Slides, Tasks, Contacts, Jira, Confluence, Skills, Platform. Each surface
shows:

- a one-word state (all passing, failing, not run) and its pass count;
- its 30-day strip;
- its cases: title, state, duration;
- its tools (below).

Surfaces follow the scenario registry, which already places every
registered case in exactly one scenario (enforced by `scenarios.test.ts`).
The display names live in one new file beside it,
`apps/gateway/src/lib/status/surfaces.ts`. That file also maps a tool's name
prefix to a surface, for rows that are about a tool rather than a case (the
next section).

- "gateway" is shown as **Platform**: the front door, the registry
  agreement, and the guards.
- **There is no agent surface.** The brief lists one, but no scenario or case
  exercises the dashboard agent today, so the page cannot show it without
  inventing it. Adding agent cases is its own ticket, and the surface appears
  when they exist.

**By tool**, within each surface: every tool the run was served AND a
member of the public is offered, from its `contract:<tool>` and
`uncovered:<tool>` rows.

The run lists tools as the admin who started it, so what it was served is
more than a user is offered. Prod run `b7ceb0f4` (2026-10-20) had four
`uncovered` rows: one was `tasks_create_tasklist`, and the other three were
the runner's own admin-only tools (`tests_run`, `tests_status`,
`tests_results`). So two kinds of tool are left off the page:
- the admin-only built-ins, decided by the same rule that hides them from a
  non-admin's `tools/list` (case R2 holds that rule);
- `PUBLICLY_UNLISTED_TOOLS` (`gws_run`), through the filter the public pages
  already share in `lib/public-tools.ts`.

For each tool shown:

- **working**: its contract probe passed, and every case covering it (the
  case's `covers`, from code) passed;
- **failing**: the probe or a covering case failed;
- **served, not yet exercised**: an `uncovered` row. Honest, and a backlog a
  user can see;
- **not run**: every covering case was skipped.

Tools are named as they are served (`gmail_send`), without the plugin prefix.

**States in words.** pass: "working". fail: "failing in the latest check".
skip: "not run in the latest check". uncovered: "served, not yet exercised".
A failure shows its title and state, never the assertion text, and a skip
never shows its reason.

**History.** A 30-day strip per surface, one cell per UTC day:
- green: the day's newest full prod run had at least one pass and no
  failure for that surface;
- red: any failure;
- grey: no full run that day, or nothing ran for that surface.

Per-case history is out of scope for v1.

**Stale banner.** When the newest qualifying run finished more than 36
hours ago, a banner says when the last full check ran. The surface states
lose their colour, so the page never shows an old green as a current one.

## What the page never shows

The runner's own rule, `no-fixture-values`, extended to the page:

- `evidence`, in any form, including a failure's text;
- a case's arguments, fixture keys or values, account emails, message ids,
  or any artifact id;
- `triggered_by`, or any user;
- skip reasons.

This is enforced by construction and by test. The read model selects only:

- from `test_runs`: `id`, `started_at`, `finished_at`, `gateway_sha`,
  `plugin_shas`;
- from `test_results`: `case_id`, `kind`, `status`, `duration_ms`,
  `cleanup`.

`evidence` and `triggered_by` are never read, so they cannot be rendered by
mistake. A render test feeds a run whose evidence holds an email, an id and
an error text, and asserts that none of them is in the HTML. A source test
asserts the read model's select names no other column.

**Case titles are public copy from this page on.** All 113 are written for
engineers today ("the fixture sheet reads back its exact control values", "a
sent message arrives in the reader mailbox carrying its token"). None is a
secret, but they do not read as "what you can do". This is open question 1.
Whatever the answer, a test pins every rendered title: no ticket ids, no
email addresses, no em dashes, no fixture key names.

## Claims

The page's numbers are data from the run, rendered from rows, never typed.
Its prose names no tool count, so `tool-count-claims.test.ts` holds without
an exception. The page claims only what the run observed and when.

## Cost and caching

The page renders per request (`force-dynamic`, like the home page). Each
request makes one indexed query: the id and finish time of the newest
qualifying run. The model behind the page (per-case rows, per-tool states,
30-day strip) is held in memory, on a `globalThis` key as other shared
state in the gateway is, keyed by that run id. It is rebuilt only when a
newer qualifying run appears, so the heavier reads (one run's results, and
30 days of qualifying runs and their results) happen once per run, not once
per visitor. The relative times and the stale banner are computed per
request from the cached finish time.

## Where it sits

- Route: `apps/gateway/src/app/status/page.tsx`, public, no login. Title
  "Status", with a description that says it is the latest end-to-end check
  of every tool.
- Indexed, in `sitemap.ts`.
- Linked from the home page footer (the only site footer, in
  `app/page.tsx`) and from the docs sidebar (`app/docs/sidebar.tsx`), as a
  fixed entry beside the content sections.

## What "daily" depends on

Nothing in the gateway schedules a run today; runs start from the
dashboard or through `tests_run`, and the daily prod run is HQ's routine.
The page does not assume it ran: the 36-hour banner is what keeps a missed
day from showing as green. Whether the gateway should schedule its own
daily full run is open question 2.

## Open questions

For HQ, and for Manuel where it is copy.

1. **Public titles.** Render the engineering titles as they are, or add a
   `publicTitle` to each case, written as a capability ("Send an email with
   your signature", "Attach an email to a Jira issue")?
   - The second is what makes the page a feature list, at 113 lines of copy.
     It is Manuel's voice and HQ's claims to sign off.
   - A required field with a test would keep a new case from shipping without
     one.
   - Recommended: `publicTitle`, drafted by the product session, reviewed by
     HQ and Manuel before the page ships.
2. **Who runs the daily check.** Keep HQ's routine, or add a gateway cron?
   - A run lists and calls as the admin who triggered it, with that admin's
     connected accounts. A cron has no such user.
   - A cron would need a named runner user, which is a decision, not code.
   - Recommended: keep the routine, and let the banner carry a missed day.
3. **Per-tool contract rows.** Show each tool's contract probe as part of
   its state, as above, or show tools only through the cases that cover
   them? Recommended: as above, since it is the only signal for a tool no
   case covers yet.
4. **Platform.** Show the gateway scenario (front door, registry agreement,
   admin-only guards) as Platform, or leave it off a page for users?
   Recommended: show it last. It is where an outage of the front door would
   appear.
