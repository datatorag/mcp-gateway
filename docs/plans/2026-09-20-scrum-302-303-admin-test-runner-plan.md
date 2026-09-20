# Build plan: the role column and the admin test runner (SCRUM-302, SCRUM-303)

Date: 2026-09-20
Status: approved with six rulings, all folded into this revision. No code
and no migration exist. Building starts only on a separate go.
Spec: `docs/architecture/2026-09-20-scrum-302-303-admin-test-runner-design.md`
(revision 3). Where the two disagree, the spec wins and this file is wrong.

## Shape

Five phases, each one a branch off main, each ending in something that can
be reviewed and shipped alone. A phase does not start until the one before
it is merged. Every phase ends the same way: full gateway suite, typecheck,
production build, security review of the outgoing diff, push, report. Merge
and deploy only on a go.

| Phase | Ticket | Ships | Human step |
|---|---|---|---|
| 1 | SCRUM-302 | role column, the admin guard, admin-only built-ins (none registered yet) | migration 0018, then the founder UPDATE |
| 2 | SCRUM-303 | the two tables, the runner engine, `GATEWAY_SHA`, no cases | migration 0019 |
| 3 | SCRUM-303 | API routes, the three tools, the admin pages | none |
| 4 | SCRUM-303 | the 52 cases, in four batches | the fixtures config value |
| 5 | SCRUM-303 | the baseline run, three cases broken on purpose, handover | none |

Rules that hold in every phase:

- Test first. Each guard gets a test, and each guard is deleted once to see
  that test go red for its own reason, then restored byte for byte. The
  commit body names the mutations that were run.
- Anything that touches the database is proven against real Postgres with
  the existing harness in `src/test-utils/db.ts`, not a fake.
- Public repo: a case, a fixture, a test id and a commit message never carry
  a real mailbox, file id or account. Test ids are invented, never derived.
- A skill that documents a pattern this work changes is updated in the same
  commit (`codebase-map`, `gateway-dev`, `deploy`, `ops-debugging`).

---

## Phase 1: the role column and the guard (SCRUM-302)

Branch `scrum-302-role-column`.

1. **Schema.** `packages/db/src/schema/users.ts`: `ROLE_VALUES`, `role text
   NOT NULL DEFAULT 'user'`. Generate `0018` with `db:generate`, read the
   SQL, and confirm it is one `ALTER TABLE ... ADD COLUMN` and nothing else.
   Rebuild `packages/db` so the gateway sees the column (the built `dist` is
   what the app imports).
2. **`src/gateway/admin.ts`.** `isAdmin(db, userId)`: one primary-key read,
   true only for the exact string `admin`. Tests: admin, user, an unknown
   value, a missing row. Real Postgres.
3. **`requireAdminPage()`** in the same module: `notFound()` for a
   signed-in non-admin. Anonymous visitors are bounced by the existing
   middleware like every dashboard path. **`src/proxy.ts` is not touched**,
   and a test pins that `/dashboard/admin` and `/dashboard/admin/tests`
   without a cookie redirect to login with the same `next` handling as a
   sibling path.
4. **`withAdminRoute`** in `src/lib/with-admin-route.ts`. Its own wrapper,
   in this order: session cookie, `isAdmin`, the cross-site check, the rate
   limiter, the handler, the generic 500 catch. Refusals return the app's
   404. Tests:
   - user role gets the 404 an unknown API path gives, compared whole:
     status, body and every header except a short allowed list;
   - no session gets that same 404;
   - a non-admin sent past the limit still gets 404, never 429, and no
     rate-limit header (mutation: move the limiter first, see it go red);
   - a live admin API key in `Authorization`, no cookie, gets 404;
   - a POST with a valid admin cookie and a foreign `Origin` gets 404, and
     so does one with no `Origin` or a non-JSON content type (mutation:
     drop the check);
   - an admin gets through, and an admin past the limit gets 429.
5. **Page parity.** A signed-in non-admin on `/dashboard/admin` gets the
   same status, body and headers as a signed-in user on a dashboard path
   that does not exist.
6. **The guarded layout.** `src/app/dashboard/admin/layout.tsx` calls
   `requireAdminPage()`, plus a placeholder `page.tsx` that renders the
   admin index so the guard has something real to guard in this phase.
   The directory-walk test lands here: every `page.tsx` under
   `dashboard/admin` sits under that layout, every `route.ts` under
   `api/admin` exports only `withAdminRoute(...)` handlers. It passes
   vacuously for routes in this phase and starts working in phase 3, so it
   is proven now with a fixture directory that breaks each rule.
7. **Admin-only built-ins.** `BUILT_IN_TOOLS` entries gain optional
   `audience: "admin"`. `ListTools` filters; `CallTool` uses one lookup
   helper that does not return an admin entry to a non-admin, so the call
   reaches the existing unknown-tool branch. No tool is registered with the
   audience yet, so the tests use an injected entry. Tests: a non-admin list
   omits it, the non-admin call result equals the unknown-tool result for a
   made-up name apart from the echoed name, the usage event is the same
   shape, the admin gets the tool. `builtinTools` on the tools-listed event
   counts what was served.
8. **`/api/me`** returns `role`. The dashboard rail gets no entry yet.
9. **The cap.** One test: an admin on a non-internal address is still
   capped. No code change expected; the test is the pin.
10. **Skills.** `codebase-map` gains the role primitive and the 404 rule.

**Human steps, in this order, each with the SQL shown first and a typed
confirmation in the product session:**

- a. Migration `0018` against production. Verify the column and default.
- b. The founder UPDATE: guarded on the current value, `RETURNING`, by user
  id, run by hand. It is not in a file in this repo.
- c. Deploy. The code reads `role`, so it goes out only after a.

Done when, in production: a user-role account gets the ordinary 404 on
`/dashboard/admin`, an anonymous browser is bounced to login exactly as on
a sibling path, and the founder account gets the placeholder page.

## Phase 2: tables, engine, and the sha

Branch `scrum-303-runner-engine`. No case exists yet; the engine is driven
by fake cases in tests.

1. **Schema.** `test-runs.ts` and `test-results.ts` per the spec, including
   `environment` and `imported_from`. Generate `0019`, read the SQL. Rebuild `packages/db`.
2. **`GATEWAY_SHA`.** `ARG` and `ENV` in `apps/gateway/Dockerfile`, the
   argument in `docker-compose.prod.yml` `build.args`, the deploy script
   exporting the verified sha into the build command, an optional string in
   the config schema (rebuild `packages/config`). `/health` does not expose
   it. The `deploy` skill gets the new hop. Verified after the first deploy
   with `printenv` inside the container, not from the host file.
3. **Plugin shas.** `src/gateway/tests/plugin-sha.ts`: read `HEAD`, follow
   a ref, fall back to `packed-refs`, all by reading files under the plugin
   directory. Unreadable gives null. Tests over fixture directories for a
   detached head, a branch ref and a packed ref.
4. **Config.** `TEST_RUNNER_FIXTURES`: a JSON string, zod-parsed into
   `{accounts: {sender, reader, atlassian}, users: {nonAdmin}, fixtures:
   {...}}`, optional. Beside it, `TEST_RUNNER_ENVIRONMENT` (`local` by
   default, `prod` set only in the production compose file).
   Absent means every case that needs a mapping skips. Four hops when it is
   set for real (phase 4): schema, parameter store, host render, compose
   `environment`.
5. **Types and registry.** `TestCase`, `CaseContext`, the barrel, and the
   registry test (barrel equals directory, ids unique and well formed,
   `needs` point at real ids, no cycles).
6. **The in-process client.** `createMcpServer` for the triggering admin
   over a linked in-memory transport pair, as the dashboard agent does,
   announcing `datatorag-test-runner`. `createMcpServer` gains one option,
   the run id, stamped on usage events as `test_run_id`. Tests: the name
   and the run id are on a `tool_call` event from a runner call and absent
   from anyone else's. No credential exists at any point.
7. **`ctx.call` and the send guard.** Account injected from the role map; a
   literal `account` argument from a case is refused. The guard covers
   `to`, `cc`, `bcc`; create and update draft; reply (reads the original);
   send draft (reads the stored draft); `gws_run` Gmail send methods and
   Gmail settings methods (forwarding, filters, send-as, delegates);
   RFC 5322 parsing with a refusal on anything unparseable, including a
   quoted display name holding a comma; and the same recipient rule on
   calendar attendees, Drive shares and Docs mentions, with notifications
   suppressed where the tool allows. One test per rule, one mutation per
   rule.
8. **`ctx.http`.** Fixed loopback base, single leading slash, origin
   re-checked, no redirects. Tests for a full URL, `//host`, a backslash,
   `/\host`, an `@` userinfo trick, and a control character.
9. **`defer` and cleanup.** Reverse order, in `finally`, each undo with its
   own timeout, one failing undo does not stop the next, `leaked` recorded.
10. **`until`, timeouts, the one transient retry, the pool of four with
    named locks, the twenty-minute ceiling.** Fake timers.
11. **The door case (`R1`).** The MCP-started path hands the caller's
    bearer to the run in memory; the case uses it once over loopback and
    drops it. Started from the UI it records `skip`, `door not exercised`.
    Tests: the tool names match the in-process list; the token appears in
    no row, event, log line or evidence (the test greps everything a run
    wrote for it); the UI path skips and does not pass. How the handler
    gets the bearer is the one open mechanism: the SDK hands request
    headers to a handler, and if that proves unreliable the HTTP layer
    passes it the way it already passes the protocol version. Whichever it
    is, it reaches `tests_run` and nothing else: no general bearer in the
    handler context that another built-in or a plugin could read. The
    token lives outside `CaseContext` and the `share` channel, the case
    runs at the gate step rather than in the queue, the reference is
    cleared in a `finally` on every exit, and the loopback request follows
    no redirect.
12. **Lifecycle.** Gate, enumerate, plan (scope, `needs` ordering, skip on a
    failed dependency), execute, contract, uncovered, finish. One run at a
    time, claimed in the database so two processes cannot both win. Rows
    still `running` at boot become `interrupted`, wired next to the cron
    registration in `server.ts`. With no key there is nothing else to
    clean at boot. Every run row records `environment`.
13. **Contract check.** `ajv` becomes a direct dependency. Steps 1 and 2 for
    every served tool. Step 3 only where `classifyWrite` says read (plugin
    tools) or the entry declares `approval: "read"` (built-ins). Tests: a
    write tool is never called (the fake client fails the test if it is), an
    unclassified tool is never called, a read tool with no required
    property is not called and says so.
14. **Evidence.** 4 KB cap with a marker, passed through
    `src/gateway/usage/redact.ts` before the write.
15. **Diff.** Pure function over two result sets, table-driven tests,
    including two environments and a case skipped on one side only.
16. **The three-way list comparison** for A4 (plugin list, registry rows,
    served list, by name) as an engine helper, since it needs the plugin
    ports the engine already knows.

**Human step:** migration `0019`, SQL shown, typed confirmation. Then
deploy on a go. Nothing can start a run yet, so this deploy is inert apart
from `GATEWAY_SHA` and the boot marking.

## Phase 3: routes, tools, pages

Branch `scrum-303-runner-surface`.

1. **Routes** under `src/app/api/admin/tests/`, all `withAdminRoute`:
   start, history, one run with filters, diff, cases, and import (stores
   another environment's exported run, read-only, `imported_from` set).
   Import answers 404 when the environment is `prod`, so a prod baseline
   can never be forged. The payload is zod-validated and size-capped, the
   evidence cap and redaction run again, `triggered_by` is the importer,
   ids are fresh, and a repeated `imported_from` is refused. The directory-walk
   test from phase 1 now has real files to hold.
2. **The three built-ins**, `audience: "admin"`. `tests_run` declares
   `write`. `tests_results` defaults to non-passes, 100 a page, cursor,
   and can return the whole run as the export. Tests: a non-admin's
   `tools/list` contains none of the three, and `tools/call` for each by
   name returns the identical error a made-up name returns, compared whole
   (mutation: remove the call-side check and leave the list filter); at most one of `tier` and `case_ids`; a second
   start returns the running id. The existing built-ins suite iterates the
   registry and calls every handler, so it would start a run. It is changed
   to call admin entries as an admin with the runner stubbed, and to assert
   the refusal for everyone else.
3. **Runner case `R2`**, the same property against the running gateway as
   the mapped `nonAdmin` user. Its in-process context can list, and call
   the three admin names and one made-up name, and nothing else; a test
   proves it refuses a plugin tool, enforced in the runner's wrapper and
   again by that context having no plugin dispatch. The mapped id must be a
   uuid, role `user`, and an internal account, so a bad config value can
   never point at a customer; otherwise the case skips and says why. Its
   `tests_run` probe carries arguments the handler would reject, so a
   broken guard shows as a wrong error and never as a started run.
4. **Pages** under the guarded layout: index with start and history, run
   detail, diff. Polls while running. Confirm controls are portaled. The
   rail entry renders only when `/api/me` says admin.
5. **No plugin registry write and no classification snapshot change.** The
   snapshot is held to the plugin registry, which has no built-ins. Nothing
   pins the other direction today, so this phase adds the test: no
   `BUILT_IN_TOOLS` name appears in the snapshot.
6. **Docs.** Nothing public. These tools are not in the public tool counts,
   and a test pins that the public count excludes `audience: "admin"`.
7. **Skills.** `codebase-map` (runner flow), `gateway-dev` (how to add a
   case), `ops-debugging` (reading a red run).

Verified on the shared dev server where the layer allows it, and on a fresh
process for `/mcp` and boot wiring, which the shared server does not reload.

Deploy on a go. After it, an admin can start a run that executes zero cases
and produces contract and uncovered rows for every served tool. That first
run is the honest starting number: every tool uncovered.

## Phase 4: the 52 cases

Branch per batch. Each batch is pushed, reviewed and deployed alone, and
each case is broken once by hand before it counts (the commit says how).

| Batch | Cases | Count | Why this order |
|---|---|---|---|
| 4a | A1 to A5, B1, B2, F1, F2, F7, G1 | 11 | no fixtures, no writes; proves the gate |
| 4b | C1 to C13 | 13 | reads against fixtures; first use of the config value |
| 4c | D1 to D7, D9, D14, D15, E1 to E5, E8 to E11, E16, E17 | 21 | round trips outside mail; first real cleanup |
| 4d | D10 to D13, E13 to E15 | 7 | mail; the send guard meets real sends |

Each case is ported from its smoke row, keeps the row's id, and states in
its file header which half, if any, stayed with the agent (A2, A3, B1, E8).

**Human step before 4b:** the `TEST_RUNNER_FIXTURES` value (accounts, the
`nonAdmin` user and the fixture ids) goes into the
parameter store and the compose `environment` list, verified with
`printenv` in the container. The value is never in the repo, a commit
message or a report in this repo.

Before 4d, one dry check on production: the guard refuses a send to any
address other than the reader, proven with a deliberate bad case run once
and then deleted.

## Phase 5: baseline and handover

1. Tier 1 against production, then a full run. Recorded as the prod
   baseline.
2. Three cases broken on purpose (a read, a round trip, a mail case), each
   must go red for its own reason, then restored. Until this is done the
   baseline is not trusted and SCRUM-289 stays held.
3. **The local leg, proven once end to end.** A local gateway with a
   candidate plugin checkout runs the suite as `local`, the prod baseline
   is exported through `tests_results` and imported, and the diff shows
   both environments and both sets of shas.
4. **The deploy rule (ruled), written into the `deploy` and `gws-mcp-dev`
   skills in this phase:** a plugin or gateway deploy requires a local run
   of the candidate with no regression against the current prod baseline,
   and a prod run after the deploy. "No regression" is the diff's
   `regressed` list being empty, with every case left out named. The prod
   run after becomes the new baseline. The run ids go in the deploy report.
5. Report to HQ: run ids, totals, the uncovered list by name, leftovers.
6. HQ's side, not this repo's: point the daily box at `tests_run`, and mark
   the 52 rows "covered by code" in the sheet from the cases endpoint.

---

## What needs a person, in one list

| # | Step | Phase | Who |
|---|---|---|---|
| 1 | Migration 0018 | 1 | Manuel, typed in the product session |
| 2 | Founder role UPDATE | 1 | Manuel, typed in the product session |
| 3 | Migration 0019 | 2 | Manuel, typed in the product session |
| 4 | `TEST_RUNNER_FIXTURES` in the parameter store | 4 | Manuel or HQ |
| 5 | Each merge and deploy | all | go through HQ |

There is no registry write anywhere in this plan.

## Risks, and what answers each

- **A run credential leaks.** There is none. The one token the run ever
  sees is the caller's own, in memory, for one loopback call.
- **Someone else's client starts a run.** Any OAuth client the founder
  account authorized can. Accepted: a run cannot be aimed, the send guard
  and one-run-at-a-time bound it, and it holds no credential.
- **A forged cross-site request starts a run.** `SameSite=Lax` plus the
  wrapper's own origin and content-type check.
- **A case mails a stranger.** The guard sits in `call`, covers all three
  recipient fields and the stored draft, and cases cannot name an account.
- **The probe writes something.** It never calls a write or an
  unclassified tool.
- **An admin path leaks its existence.** Anonymous visitors bounce to login
  like every sibling; a signed-in non-admin gets a 404 that matches an
  unknown path in status, body and headers, over-limit included; a
  directory walk so a new page cannot skip the guard.
- **A deploy mid-run.** The run dies, the row becomes `interrupted` at
  boot, stamped leftovers are reported by the next run.
- **`role` grows powers by accident.** A test pins that it does not lift
  the cap.

## Settled in the plan review

1. Phase 1 ships a placeholder admin page, so the guard is proven in
   production before anything sits behind it. Yes.
2. The direction of the reply fixture thread is decided when batch 4d is
   planned.
3. Mail last is fine.
