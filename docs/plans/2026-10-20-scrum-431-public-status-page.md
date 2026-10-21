# Public status page: implementation plan (SCRUM-431)

Date: 2026-10-20. Design:
`docs/architecture/2026-10-20-scrum-431-public-status-page-design.md`.
Status: plan only. The build starts after HQ and Manuel have reviewed the
design and answered its open questions.

Rules for every step:
- This repo is public: the rule, never the evidence.
- No em dashes.
- Browser checks use the chrome-devtools MCP, never Computer Use.
- A guard counts once it has been seen to fail against what it guards.
- No deploy from the product session.

## 1. The surface map

- `apps/gateway/src/lib/status/surfaces.ts`: the display name and order of
  each scenario key, and the tool-prefix-to-surface map for tool rows.
- Test: every scenario key has a display name; every tool the registry
  snapshot classifies maps to a surface; the order is the design's.

## 2. The read model

`apps/gateway/src/lib/status/read-model.ts`:

- **The newest qualifying run:** prod, finished, not imported, full scope.
- **Its results**, selecting only the columns the design names.
- **The 30-day strip:** qualifying runs per UTC day, the newest per day, and
  per surface its verdict.
- **The join to the case registry:** title, surface, and `covers`. Retired
  cases are counted, never listed.
- **The per-tool states**, from the contract and uncovered rows and the
  covering cases.
- **The in-memory cache**, keyed by the newest run id, on a `globalThis` key.

Tests:
- **The qualifying filter:** a newer scoped run, a newer imported run, a newer
  local run and a newer interrupted run are each passed over. Each case has
  a known-bad run that a looser filter would pick.
- **The selected columns:** `evidence` and `triggered_by` are never named.
  This is read from the SQL drizzle builds.
- **Retired and new cases** are handled as the design says.
- **Tools that are not public:** an admin-only built-in (`tests_run`) and
  `gws_run`, each with a contract or uncovered row in the run, appear in no
  list and no count. This uses the same rule a non-admin's `tools/list` uses.
- **The strip:** a failing day is red, a missing day grey, and only the
  day's newest run counts.
- **The cache:** a second request with the same newest run id builds nothing.

## 3. Public titles (if question 1 says so)

- A required `publicTitle` on `TestCase`, filled in for every case in one
  commit, drafted in capability language and sent to HQ and Manuel as text
  before it merges.
- Test: every case has one, and no rendered title carries a ticket id, an
  email, an em dash or a fixture key name.

## 4. The page

`apps/gateway/src/app/status/page.tsx`, with components beside it:
- the header;
- the surface sections;
- the case and tool lists;
- the strip;
- the stale banner.

Also:
- metadata (title and description);
- the `sitemap.ts` entry;
- the home footer link and the docs sidebar entry.

Tests:
- **A snapshot render** from a fixed model.
- **The privacy render test:** evidence holding an email, an id and an error
  text, none of which reaches the HTML.
- **The stale banner** at 35 and 37 hours.
- **The no-run state.**
- `tool-count-claims.test.ts` stays green with the page in scope.

## 5. Checks before the PR

- **The gate**, with typecheck and the suite.
- **The production build.**
- **The route served locally** from a database holding real runs:
  - fresh;
  - stale;
  - with a failing case.
- **Screenshots** at 1440 and 390, through the chrome-devtools MCP:
  - the whole page;
  - one surface with a failure;
  - the banner.
- **The security review** of the outgoing diff, with the privacy test as its
  first question.

## 6. Report

A report to HQ: the PR, the sha, the screenshots, and what the page shows
for the newest prod run. HQ merges and deploys on Manuel's go.

## Not in this plan

- Per-case history.
- An agent surface, until agent cases exist.
- A gateway-scheduled daily run (question 2).
- Uptime pinging of any kind.
