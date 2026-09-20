# A role column, and a test runner the gateway runs against itself (SCRUM-302, SCRUM-303)

Date: 2026-09-20
Status: accepted, revision 2. Review settled the open questions (see
Rulings) and this revision folds in the security review's design notes. The
build plan is `docs/plans/2026-09-20-scrum-302-303-admin-test-runner-plan.md`.
No code and no migration exist yet.

## Problem

The daily smoke suite is a sheet of prose cases that a model reads and
executes by hand, one tool call at a time. Most of that effort proves that
nothing changed. A model is the wrong instrument for a case that is "call
this, assert that, clean up", and the only instrument for a case that needs
judgment.

The plugin is also about to be rewritten in four steps. Each step needs the
same question answered by the same instrument: what worked before, and does
it still. That needs a suite that lives in code, runs on demand, records its
results as rows, and can be diffed run against run.

The gateway has no way to say "this user may do that". `users` carries a
plan. The internal-email check is a domain test used for mail and alerts,
not an authorization rule, and it would make every test account an admin.

## Decision, in one paragraph

`users.role` (`user | admin`) is the first authorization primitive
(SCRUM-302). On top of it sits a runner inside the gateway (SCRUM-303):
cases are TypeScript modules, the runner is an MCP client of the gateway's
own `/mcp` over loopback, results are rows in two tables, an admin page
starts runs and compares them, and three admin-only built-in tools let an
agent do the same in three calls.

---

## Part 1: the role column (SCRUM-302)

### Schema

`users.role text NOT NULL DEFAULT 'user'`, typed in the schema file the way
`plan` is: `ROLE_VALUES = ["user", "admin"] as const`. No check constraint,
for the same reason `plan` has none; the read treats any value other than
`"admin"` as `user` (least privilege, the rule `planLimits` already follows
for an unknown plan).

The migration only adds the column. Setting the founder accounts to `admin`
is a separate, hand-run UPDATE, guarded and returning, shown before it runs.
It is not in the migration file: a migration runs in every environment, and
a public repo does not name accounts.

### `requireAdmin`

One module, `src/gateway/admin.ts`:

- `isAdmin(db, userId): Promise<boolean>` reads the column and nothing else.
  Never the email, never the domain, never the plan.
- `requireAdminPage()` for server components: resolves the session user,
  and calls Next's `notFound()` unless `isAdmin`. No session also gives 404,
  not a login redirect. A redirect on an admin path tells a stranger the
  path exists.
- `withAdminRoute(handler)` for JSON routes. Same error envelope as
  `withRoute`, but it is its own wrapper and not a layer over it, because
  the order of the checks is the point: session, then role, then the rate
  limit. Every refusal before the rate limit (no session, not admin) is the
  app's ordinary 404 body with status 404. Never 401, never 403, and never
  429: `withRoute` rate-limits any signed-in user, so a non-admin hammering
  an admin path would get a 429 that an unknown path never gives, and that
  difference names the path. Only an admin can reach the limiter.
- The admin routes accept the session cookie and nothing else. An API key
  or an OAuth bearer in an `Authorization` header is ignored, so the key a
  run mints for `/mcp` cannot open the admin JSON routes. A test sends a
  live admin key to an admin route and requires the 404.
- Every page under `/dashboard/admin` gets the check from one place, a
  `layout.tsx` in that directory that calls `requireAdminPage()`. A layout
  alone is not proof (a route handler or a page in a parallel segment can
  sit outside it), so a test walks `src/app/dashboard/admin` and
  `src/app/api/admin` and fails on any `page.tsx` not under the guarded
  layout and any `route.ts` whose exports are not wrapped.
- `src/proxy.ts` gates `/dashboard/*` on the session cookie and would bounce
  an anonymous request for `/dashboard/admin/*` to login. It gets one
  exception: under `/dashboard/admin`, no cookie means fall through to the
  page, which answers 404. The match is on a path boundary (the path equals
  `/dashboard/admin` or starts with `/dashboard/admin/`), never a bare
  prefix: `/dashboard/administrator` is an ordinary dashboard path and still
  bounces to login. The middleware cannot read the role (no database
  at the edge of the request), so the page is the authority and the
  middleware only stays out of its way.

No caching of the role. It is one indexed primary-key read on surfaces that
see a handful of requests a day, and a cached role is a revocation that
does not take effect.

### Admin-only MCP tools

`BUILT_IN_TOOLS` entries gain an optional `audience: "admin"`. Two checks,
both reading `isAdmin`:

- `ListTools` leaves an admin entry out for anyone else.
- `CallTool` answers a non-admin exactly as it answers a tool name that does
  not exist. This is the MCP form of the 404 rule: the listing filter is
  presentation, the call check is the guard, and a guard that lives only in
  the listing is not one. It is built as a lookup that does not find the
  entry for a non-admin, so the call falls through to the existing
  unknown-tool branch rather than imitating it: same text, same usage
  event, same timing class, by construction.

`role = admin` grants these surfaces and nothing else. It does not exempt
an account from the call cap, the run allowance or any rate limit. The cap
exemption stays where it is, on the internal-account check, and a test pins
that an admin on a non-internal address is still capped.

`builtinTools` on the tools-listed event counts what was served, so it moves
for admins only.

### Tests

Helper unit tests (admin, user, unknown value, missing row). One route test
with a real session for a `user`-role account: 404, and the body is the same
body an unknown path gives. One for an admin: through. One for no session:
404, no redirect. For the MCP side: a non-admin's `tools/list` has no admin
entry, and a direct call returns the unknown-tool error byte for byte. Each
guard is deleted once to see its test fail.

---

## Part 2: the runner (SCRUM-303)

### Schema

```
test_runs
  id              uuid pk
  triggered_by    uuid  -> users.id   (who pressed the button or called the tool)
  trigger         text  'ui' | 'mcp'
  scope           jsonb {tier?: 1|2, caseIds?: string[]}   what was asked for
  status          text  'running' | 'finished' | 'aborted' | 'interrupted'
  started_at      timestamptz
  finished_at     timestamptz null
  runner_key_id   uuid null    the API key minted for this run; see Credential
  gateway_sha     text null    the build that served the run
  plugin_shas     jsonb        {slug: sha} as read at run start
  tools_served    integer      size of tools/list for the run's identity
  totals          jsonb        {pass, fail, skip, uncovered}
  index (started_at desc)

test_results
  id            uuid pk
  run_id        uuid -> test_runs.id on delete cascade
  case_id       text    'D15', or 'contract:<tool>', or 'uncovered:<tool>'
  kind          text    'case' | 'contract' | 'uncovered'
  status        text    'pass' | 'fail' | 'skip' | 'uncovered'
  duration_ms   integer
  evidence      text    capped, see Evidence
  cleanup       text    'clean' | 'none_needed' | 'leaked'
  unique (run_id, case_id)
```

Two tables for the runner plus the role column: three schema changes. No
cases table. A case is code; its id, tier and description are read from the
module, so a case cannot exist in one place and not the other.

`cleanup` is its own column because "the assertion passed and the cleanup
leaked" and "the assertion failed and the cleanup was clean" are both
states a reader needs, and neither fits in one status.

### Migration order

1. `0018` adds `users.role`. Ships with SCRUM-302.
2. The founder UPDATE, by hand, after 1 is confirmed in place.
3. `0019` creates `test_runs` and `test_results`. Ships with SCRUM-303.

Each takes a typed confirmation in the product session, with the SQL shown
first. Nothing migrates on boot, so code that reads a new column deploys
only after its migration has run; SCRUM-302's code reads `role`, so the
order is migration, UPDATE, then deploy.

**No registry write is needed for the three tools.** The ticket expects
one. Gateway built-ins live in `BUILT_IN_TOOLS`, in code, and are appended
to `tools/list` from there; the `tools` table holds plugin tools only, and
the classification snapshot must never carry a built-in. The three tools
ship with the deploy.

### The case module

One file per case under `src/gateway/tests/cases/`, named by id
(`d15-attachment-bytes.ts`). A barrel lists them; a unit test asserts the
barrel and the directory agree, ids are unique, and every id is well formed.

```ts
export interface TestCase {
  id: string;                 // the smoke row it descends from: "D15"
  title: string;
  tier: 1 | 2;
  covers: string[];           // namespaced tool names this case exercises
  accounts: AccountRole[];    // roles it needs: "sender", "reader", "atlassian"
  fixtures?: FixtureKey[];    // named fixtures it needs
  needs?: string[];           // case ids whose output it rides ("D10")
  timeoutMs?: number;         // default 60_000
  serial?: string;            // a lock name; see Concurrency
  run(ctx: CaseContext): Promise<void>;
}

export interface CaseContext {
  runId: string;
  stamp: string;                       // unique per run and case, for names
  call(tool: string, args: object, opts?: { as?: AccountRole }): Promise<ToolResult>;
  rpc(method: string, params?: object): Promise<unknown>;   // tools/list etc.
  http(path: string, init?: RequestInit): Promise<Response>; // loopback only, see below
  fixture(key: FixtureKey): string;
  from(caseId: string): Record<string, unknown>;  // what a needed case shared
  share(values: Record<string, unknown>): void;
  defer(label: string, undo: () => Promise<void>): void;    // see Cleanup
  evidence(line: string): void;
  until<T>(what: string, probe: () => Promise<T | undefined>, opts?: { everyMs?: number; forMs?: number }): Promise<T>;
}
```

A case passes by returning and fails by throwing. Assertions are plain
`expect`-style helpers that throw an error whose message is the evidence.
There is no model anywhere in the path.

`http` cannot leave the machine. It builds every URL from one fixed base,
`http://127.0.0.1:<GATEWAY_PORT>`, and takes a path, not a URL. Input is
refused unless it starts with exactly one `/`: no scheme, no `//host`
protocol-relative form, no backslash, no control character. After building,
the URL's origin is compared with the base and a mismatch throws. Redirects
are not followed. It sends no credential by default, because its cases are
the anonymous ones (health, the metadata documents, a 401 from `/mcp`).

`until` is the one way to wait. Mail arrival, a deleted file going absent
and similar are polls with a stated budget, never a sleep.

### Accounts and fixtures are named, never written down

This repo is public, so a case never contains a mailbox, a file id or an
event id. A case declares a **role** (`sender`, `reader`, `atlassian`) and a
**fixture key** (`sheet`, `scratchTab`, `folder`, `doc`, `deck`,
`calendarEvent`, `querySheet`). The mapping from role to connected account,
and from key to id, is one config value, `TEST_RUNNER_FIXTURES` (JSON,
zod-validated, held in the parameter store like every other secret-adjacent
value). A missing role or key skips the cases that need it with the reason
named. It never falls back to a default account: a test that silently runs
as the wrong account is worse than one that does not run.

`call(tool, args, { as: "reader" })` sets the tool's `account` argument from
the mapping. A case cannot pass a literal account.

The send rule is enforced in `call`, not left to each case: any tool in the
send set is refused before dispatch unless every recipient equals the
`reader` mailbox and the subject starts with `[smoke]`. A case that tries
anything else fails with that reason.

- Recipients means `to`, `cc` and `bcc`, each split on commas and compared
  as a bare lowercased address. One stray address in any of the three
  refuses the call. An empty `to` refuses too.
- `gmail_send`, `gmail_forward`, `gmail_create_draft` and
  `gmail_update_draft` are checked on their arguments. A draft is checked
  when it is written so that a bad one never exists.
- `gmail_reply` has no recipient argument: the reply goes wherever the
  original message says. So the guard reads the message being replied to
  through `/mcp` first, and requires that its `Reply-To` (or `From` when
  there is none) is the `reader` mailbox and that its subject carries the
  `[smoke]` prefix, with or without a leading `Re:`.
- `gmail_send_draft` has no recipients in its arguments at all. The guard
  reads the **stored** draft through `/mcp` at send time and checks its
  `To`, `Cc`, `Bcc` and `Subject` headers. The arguments the draft was
  created with are not trusted: a draft can be edited between the two calls.
- `gws_run` is refused for any Gmail method that sends (`send` on messages
  or drafts, and `import`/`insert`). The generic tool must not be a way
  around the named ones.

A unit test pins each bullet, and deleting any one check must turn its own
test red.

### How the runner reaches `/mcp`, and as whom

The runner is an MCP client (the SDK's Streamable HTTP client) pointed at
`http://127.0.0.1:<GATEWAY_PORT>/mcp`. Same bearer check, same session
handling, same `ListTools` filter, same `CallTool` path, same metering, same
plugin dispatch as any outside client. The dashboard agent's in-process
construction would be shorter and would skip the door the refactors are
most likely to break.

**Identity: the admin who triggered the run.** The run lists and calls as
that user, with that user's connected accounts. There is no separate runner
user. Today one admin holds the fixture accounts; another admin's run skips
what it cannot reach, by the rule above, and says so.

**Credential: an API key minted for the run, not a session.**

- At run start the runner mints a key for the triggering admin through the
  same function the dashboard uses, named `test-runner <run id>`, writes the
  key's **id** to `test_runs.runner_key_id`, and revokes that id in a
  `finally` when the run ends.
- Revocation is always by the id on the run row, never by matching a name.
  A name is something a user types: a person can call their own key
  `test-runner something`, and a sweep by prefix would revoke it. At boot
  and at each run start, the sweep reads run rows that are not `running`
  and still point at a live key, and revokes those ids. The name is a label
  for a person reading the keys page and carries no logic.
- The key opens `/mcp` and nothing else. The admin JSON routes are
  cookie-only (Part 1), so a leaked run key cannot start or read runs
  through them.
- A session token would work and is the wrong shape: it is a browser
  credential with `client_id: web`, so runner traffic would be
  indistinguishable from a person clicking in the dashboard. A key gives
  `client_id: api-key` and `auth_kind: api_key` for free, and the runner
  sends `clientInfo.name: datatorag-test-runner`, so analytics can exclude
  or isolate it with one filter.
- A long-lived key in config was the other option. Rejected: a standing
  secret for an admin identity that has to be stored, rendered and rotated,
  to save one insert and one update per run.
- The raw key exists only in the runner's memory for the length of the run.
  It is never written to a row, an event, a log line or evidence.
- The key counts against the ten-live-keys cap. If the admin is at the cap,
  the run refuses to start and says why.

The runner never resolves, reads or handles a provider token. It sends tool
calls; the gateway does what it does for any client.

Runner calls are metered like any call. Today's admins are internal
accounts, which are exempt from the cap, so a run cannot exhaust an
allowance. That exemption comes from the internal-account check and only
from it. The runner adds no exemption of its own and `role` grants none, so
an admin on an outside address would spend their own allowance on a run.
The run does add `tool_call` events; the client name is how to filter them.

### Run lifecycle

1. **Gate.** `GET /health` on loopback and an `initialize` plus
   `tools/list`. If either fails, the run is `aborted`, the section-A cases
   are recorded as failed, and nothing else runs. Forty cascading failures
   say nothing the first did not.
2. **Enumerate.** The served `tools/list` for this identity is the run's
   universe and is kept for the contract and uncovered steps.
3. **Plan.** Select cases by scope; order by `needs`; a case whose
   dependency failed or skipped is a `skip` naming it.
4. **Execute** with bounded concurrency (below).
5. **Contract** checks, one per served tool.
6. **Uncovered** rows, one per served tool no case covers.
7. **Finish.** Totals, `finished_at`, status. Revoke the key.

The run executes in the background of the server process. The HTTP request
or tool call that started it returns the run id at once. Results are written
as each case finishes, so a poll sees progress.

One run at a time, process-wide. A second start while one is running is
refused with the running id. Two runs would race on the same scratch tab
and the same labels. At boot, any row still `running` is marked
`interrupted`: a deploy restarts the process and the run dies with it.

### Concurrency, timeouts, retries

- Pool of **4**. Cases that share mutable state declare `serial: "<lock>"`
  and cases with the same lock never overlap: the sheet scratch tab, the
  mail thread group (D10 to D13, E13 to E15), the Jira board baseline.
- Per-case timeout, default 60 s, overridable per case (mail arrival cases
  need about 120 s). A timeout is a `fail` with the last evidence line, and
  its deferred cleanups still run.
- Whole-run ceiling of 20 minutes. Past it, unstarted cases are `skip` with
  that reason and the run is `aborted`.
- One retry, only for a transient upstream failure (the plugin's own
  retryable marker, a 5xx, a timeout inside a call). The evidence says it
  retried. An assertion failure is never retried.

### Cleanup when a case fails midway

A case registers an undo **before or immediately after** the step that
creates something: `defer("trash draft", ...)`. The runner runs every
registered undo in reverse order in a `finally`, whether the body passed,
threw or timed out. Each undo gets its own timeout and its failure does not
stop the next.

An undo is not done until a read says so. The helper for each resource pairs
the delete with the read that goes absent soonest (a listing or a search,
not a get by id, which can keep answering for a while after a delete; a
cancelled calendar event stays gettable forever). `cleanup = clean` needs
that read. A failed undo gives `cleanup = leaked`, the evidence names the
artifact, and the run is not green even if every assertion passed.

Everything a case creates carries the run stamp and a `[smoke]` prefix. The
next run's gate step searches for stamped leftovers older than the ceiling
in each zone (scratch tab, fixture folder, drafts, the smoke label, the Jira
label) and reports them as one `leftovers` result. v1 reports; it does not
delete what it did not create in this run.

Mail cases label what they send and receive, then trash both copies through
the fallback tool and read them back as trashed, as the sheet's newest rows
already do.

### "Uncovered", and the contract check

`covered = union of every registered case's covers`. For each name in the
served list that is not in `covered`, the run writes
`uncovered:<tool>` with status `uncovered`. A run with any `uncovered`,
`fail`, `leaked` cleanup or tier-1 `skip` is not fully green.

Two honest limits. `covers` is a declaration, so the runner also records the
tool names each case actually called and fails a case that declares a tool
it never called. And the served list is per identity: a tool behind a
service the admin has not connected is invisible, so it cannot be reported
uncovered. The plugin's own list closes that gap (next section).

The contract check, per served tool, no case needed:

1. It is served (by construction) and, for a plugin tool, its registry row
   exists and is enabled.
2. Its `inputSchema` compiles as JSON Schema and declares
   `type: "object"`. The validator is `ajv`, which the MCP SDK already
   brings in; it becomes a direct dependency of the gateway rather than one
   reached through another package.
3. **Read tools only.** If the tool is a read and its schema has at least
   one `required` property, call it with `{}` and require an `isError`
   result whose text names a missing argument. A thrown protocol error, a
   5xx-shaped message or a success is a fail. A read tool with no required
   property gets steps 1 and 2 only and says so.

Write tools get steps 1 and 2 and never step 3 (ruled in review). `required`
is a declaration in a schema, not proof that the handler validates before
it acts, and the plugin is about to be rewritten four times. A write
handler that reads an optional default and acts on `{}` would be found by
the probe acting. Read or write comes from the same place the agent's
approval gate uses: `classifyWrite` for a plugin tool, the declared
`approval` for a built-in. That classifier fails closed, so a tool nobody
has classified counts as a write and is not probed. Each contract result
says which steps ran.

### What moves from the sheet's A4 into the runner

The runner is inside the container, so it can do the leg the agent never
could: ask each plugin process for its own tool list. The A4 case compares
three things by name, not by count: the plugin's list, the enabled registry
rows, and what `/mcp` served. A tool a plugin offers that the registry lacks
is reported by name. This also catches the uncovered-but-invisible case
above.

### The shas a run records

The gateway does not know its own sha today; the deploy script writes it to
a file on the host, outside the container. v1 adds a build argument that
bakes the sha into the image as `GATEWAY_SHA`, and `/health` does not expose
it. Plugin shas are read at run start from each plugin checkout's git
metadata by reading files, not by spawning `git`. A value that cannot be
read is stored as null and the diff says "sha unknown", never a guess.

### Evidence

Evidence is what a person needs to believe the result: the assertion that
failed, expected against actual, ids of created artifacts, durations, retry
notes. Capped at 4 KB per result, truncated with a marker.

It must not become a second copy of a mailbox. Helpers record shapes and
comparisons, not payloads: "body contains the token: yes", not the body.
Anything token-shaped is masked by the existing redaction module before the
row is written. No account address, no raw tool result and no credential
is ever evidence.

### Results diff

`diff(runA, runB)` joins results on `case_id` and returns four lists:
`regressed` (pass to anything else), `fixed`, `added` and `removed` (cases
or tools present in one run only), plus every status change that fits
neither. Each entry carries both evidences. The header shows both runs'
gateway and plugin shas, which is the point: "these eleven changed between
plugin sha X and Y". Duration changes are shown and never counted as
regressions.

A run scoped to a tier or a case list diffs only over the cases both runs
executed, and says how many it left out.

### UI: `/dashboard/admin/tests`

All under `requireAdminPage`, all 404 otherwise. One rail entry, rendered
only when `/api/me` reports `role: admin`.

- `/dashboard/admin/tests` : start a run (all, tier 1, tier 2), the running
  run's progress, history (newest first: when, who, trigger, shas, totals),
  and the current uncovered list from the latest full run.
- `/dashboard/admin/tests/[runId]` : results grouped by section, filter by
  status, evidence expandable, "run this case again", "compare with...".
- `/dashboard/admin/tests/[runId]/diff/[otherId]` : the diff.

API, all `withAdminRoute`: `POST /api/admin/tests/runs` (start),
`GET /api/admin/tests/runs` (history), `GET /api/admin/tests/runs/[id]`
(status and results, with `status` and `kind` filters),
`GET /api/admin/tests/runs/[id]/diff?against=`,
`GET /api/admin/tests/cases` (the registered cases, for the run-one picker).

The page polls the run while it is `running`. Any confirm control is
portaled, per the dashboard shell's clipping rule.

### The three MCP tools

Built-ins, `audience: "admin"`. All three declare `approval: "read"` for the
agent's gate except `tests_run`, which declares `write`: it sends mail and
creates files.

```
tests_run
  input:  { tier?: 1 | 2, case_ids?: string[] }   at most one; neither = all
  output: { run_id, status: "running", cases: <n> }
          or isError naming the run already in progress

tests_status
  input:  { run_id: string }
  output: { run_id, status, started_at, finished_at?, gateway_sha, plugin_shas,
            totals, done: <n>, of: <n> }

tests_results
  input:  { run_id: string,
            filter?: { status?: ("pass"|"fail"|"skip"|"uncovered")[],
                       kind?: ("case"|"contract"|"uncovered")[],
                       cleanup?: ("leaked")[] },
            against?: string }        a run id: return the diff instead
  output: { run_id, totals, results: [{case_id, kind, status, cleanup,
            duration_ms, evidence}] }  or the diff shape
```

`tests_results` defaults to everything that is not a pass, because that is
what the caller reads a run for; passes are in the totals. It returns at
most 100 results a call with a cursor. With evidence capped at 4 KB a page
is bounded; the playground's output cap is not on this path and is not
relied on.

The daily run is the box calling `tests_run` over its ordinary OAuth
connection to `/mcp`, as the founder account. It needs no API key of its
own and the gateway has no scheduler: the three calls are `tests_run`, poll
`tests_status`, read `tests_results`. The caller's OAuth token is never
reused by the runner. The run still mints its own per-run key for its
loopback client, for the reason under Credential: that key is what makes
runner traffic separable from the caller's, whichever door started the run.

---

## The smoke rows, classified

The sheet has **62** case ids, not 63: 61 live and one retired.

| Bucket | Count |
|---|---|
| Portable to code | **52** |
| Agent-only | **9** |
| Retired, not ported | **1** |

**Portable (52).**

| Section | Rows |
|---|---|
| A reachability | A1, A2, A3, A4, A5 |
| B auth | B1, B2 |
| C reads | C1, C2, C3, C4, C5, C6, C7, C8, C9, C10, C11, C12, C13 |
| D round trips | D1, D2, D3, D4, D5, D6, D7, D9, D10, D11, D12, D13, D14, D15 |
| E regression guards | E1, E2, E3, E4, E5, E8, E9, E10, E11, E13, E14, E15, E16, E17 |
| F security guards | F1, F2, F7 |
| G errors | G1 |

Four of these port without one half, because that half reads the analytics
store: A2 and A3 (the session and tools-listed events; the runner asserts
the handshake and the count from the wire against the connected-services
formula instead), B1 (the refresh event; the runner asserts the call), and
E8 (the runner asserts the served schema and the registry row, which is the
strict reading). The dropped halves stay with the agent as one line each.

Two get stronger in code. A4 gains the plugin's own list, which the agent
could not reach. F7 gains its positive half: the runner's own key being
accepted is the control the sheet says it was waiting for.

**Agent-only (9).**

| Row | Why |
|---|---|
| E6 | Reads stored grants for every user; a population query against the database, ruled agent-only |
| E7 | Reads analytics events and reports the most recent true and false; "detector unobserved" is a judgment |
| E12 | Raw stored scopes against the classifier, with controls, in the database; ruled agent-only |
| F3 | Needs the consent redirect, which needs a browser session the runner does not hold |
| F4 | The redacted sink is the analytics store |
| F5 | Published claims against the privacy policy; reading prose is judgment |
| F6 | Two second stores (the usage row and the analytics property) |
| G2 | Analytics event status, read by projection |
| H1 | One analytics event per call, both metering directions |

E6, E12 and the usage-row half of F6 are deterministic, and the runner has a
database handle, so they could become a fourth result kind later. They are
left out of v1 because the ruling lists them and because a runner that
queries user grants is a different trust question from one that calls tools.

**Retired (1).** D8, superseded by C11.

## Left out of v1, on purpose

- An interactive playground for one-off calls (its own ticket).
- A schedule. The box calls `tests_run` daily over its OAuth connection;
  the gateway does not run itself on a timer (ruled).
- A CLI. It would be a thin client of the same API.
- Database and analytics assertions (the nine agent-only rows).
- Deleting leftovers the current run did not create. Reported, not removed.
- Parallel runs, and runs as a user other than the one who triggered.
- Alerts. A red run is a row and a page; nothing posts to chat.
- Writing the "covered by" column back to the smoke sheet. `GET
  /api/admin/tests/cases` is the source; the sheet is updated by whoever
  owns the sheet.
- Retention. Two small tables at one run a day need no pruning in v1.
- A self-test that breaks each guard on purpose. Each case is broken once by
  hand before it is trusted, and the commit says so; automating that is
  later work.

## Rulings from review

1. **Contract probe.** `{}` is sent to read tools only. Write tools get the
   schema checks and nothing is ever called.
2. **Identity.** The triggering admin. There is no runner user.
3. **`GATEWAY_SHA`** is baked into the image in v1. The hops: a build
   argument and `ENV` in the gateway Dockerfile, the argument in the prod
   compose file's `build.args`, and the deploy script exporting the checked
   out sha before it builds. It is a build-time value, so it is not in the
   parameter store and not in the compose `environment` list. A local build
   without it records null.
4. **The daily run** needs no API key and no scheduler: the box calls
   `tests_run` over its OAuth connection.
5. SCRUM-302's last line names SCRUM-302 as its own first consumer. Read as
   SCRUM-303.

## Verification, when it is built

Unit: the case registry invariants, the send guard, the undo ordering
(a case that throws after two defers runs both, in reverse, and a failing
undo does not stop the next), the diff, the scope selection, `isAdmin` and
both 404 paths, the admin-route check order (a non-admin never reaches the
limiter), the path-boundary match in the middleware, the directory walk
over admin pages and routes, `ctx.http`'s refusals, revoke-by-id with a
user key that shares the name prefix left alone, and the probe skipping
every write tool. Each guard deleted once to see red.

Against real Postgres (the testcontainers harness): the two tables, the
one-run-at-a-time claim, `interrupted` on boot, key mint and revoke around a
run including the crash sweep.

Live: a tier-1 run against production, then a full run, recorded as the
baseline. Before the baseline is trusted, three cases are broken on purpose
(a read, a round trip, a mail case) and each must go red for its own reason.
