# Build plan: the role column and the admin test runner (SCRUM-302, SCRUM-303)

Date: 2026-09-20
Status: plan for review. No code and no migration exist. Nothing here starts
until this plan is accepted.
Spec: `docs/architecture/2026-09-20-scrum-302-303-admin-test-runner-design.md`
(revision 2). Where the two disagree, the spec wins and this file is wrong.

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
3. **`requireAdminPage()`** in the same module: session, then `isAdmin`,
   else `notFound()`. No redirect on any branch.
4. **`withAdminRoute`** in `src/lib/with-admin-route.ts`. Its own wrapper,
   in this order: session cookie, `isAdmin`, the rate limiter, the handler,
   the generic 500 catch. The two refusals return the app's 404. Tests:
   - user role gets 404 with the same body an unknown API path gives;
   - no session gets 404;
   - a non-admin sent past the limit still gets 404, never 429 (mutation:
     move the limiter first, see it go red);
   - a live admin API key in `Authorization`, no cookie, gets 404;
   - an admin gets through, and an admin past the limit gets 429.
5. **Middleware.** `src/proxy.ts`: no cookie under `/dashboard/admin` falls
   through. Boundary match. Tests: `/dashboard/admin` and
   `/dashboard/admin/tests` fall through; `/dashboard/administrator` and
   `/dashboard/admin-x` still bounce to login; every other dashboard path
   is unchanged (mutation: swap to `startsWith("/dashboard/admin")`).
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

Done when: a user-role account and an anonymous browser both get the
ordinary 404 on `/dashboard/admin` in production, and the founder account
gets the placeholder page.

## Phase 2: tables, engine, and the sha

Branch `scrum-303-runner-engine`. No case exists yet; the engine is driven
by fake cases in tests.

1. **Schema.** `test-runs.ts` and `test-results.ts` per the spec, including
   `runner_key_id`. Generate `0019`, read the SQL. Rebuild `packages/db`.
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
   `{accounts: {sender, reader, atlassian}, fixtures: {...}}`, optional.
   Absent means every case that needs a mapping skips. Four hops when it is
   set for real (phase 4): schema, parameter store, host render, compose
   `environment`.
5. **Types and registry.** `TestCase`, `CaseContext`, the barrel, and the
   registry test (barrel equals directory, ids unique and well formed,
   `needs` point at real ids, no cycles).
6. **The MCP client.** Streamable HTTP to `http://127.0.0.1:<port>/mcp`,
   `clientInfo.name: datatorag-test-runner`, the run key as bearer.
7. **`ctx.call` and the send guard.** Account injected from the role map; a
   literal `account` argument from a case is refused. The guard covers
   `to`, `cc`, `bcc`; create and update draft; reply (reads the original);
   send draft (reads the stored draft); `gws_run` Gmail send methods. One
   test per rule, one mutation per rule.
8. **`ctx.http`.** Fixed loopback base, single leading slash, origin
   re-checked, no redirects. Tests for a full URL, `//host`, a backslash,
   `/\host`, an `@` userinfo trick, and a control character.
9. **`defer` and cleanup.** Reverse order, in `finally`, each undo with its
   own timeout, one failing undo does not stop the next, `leaked` recorded.
10. **`until`, timeouts, the one transient retry, the pool of four with
    named locks, the twenty-minute ceiling.** Fake timers.
11. **Key lifecycle.** Mint through `createApiKey`, store the id on the run
    row, revoke by id in `finally`. Refuse to start at the ten-key cap. The
    sweep reads non-running rows whose key is still live. Real Postgres
    tests: revoke after a pass, after a throw, after a simulated crash then
    sweep, and a user's own key named `test-runner mine` is never touched
    (mutation: sweep by name prefix, see that test go red). The raw key
    never reaches a row, a log line or evidence; a test greps the captured
    output of a run for it.
12. **Lifecycle.** Gate, enumerate, plan (scope, `needs` ordering, skip on a
    failed dependency), execute, contract, uncovered, finish. One run at a
    time, claimed in the database so two processes cannot both win. Rows
    still `running` at boot become `interrupted`, wired next to the cron
    registration in `server.ts`.
13. **Contract check.** `ajv` becomes a direct dependency. Steps 1 and 2 for
    every served tool. Step 3 only where `classifyWrite` says read (plugin
    tools) or the entry declares `approval: "read"` (built-ins). Tests: a
    write tool is never called (the fake client fails the test if it is), an
    unclassified tool is never called, a read tool with no required
    property is not called and says so.
14. **Evidence.** 4 KB cap with a marker, passed through
    `src/gateway/usage/redact.ts` before the write.
15. **Diff.** Pure function, table-driven tests.
16. **The three-way list comparison** for A4 (plugin list, registry rows,
    served list, by name) as an engine helper, since it needs the plugin
    ports the engine already knows.

**Human step:** migration `0019`, SQL shown, typed confirmation. Then
deploy on a go. Nothing can start a run yet, so this deploy is inert apart
from `GATEWAY_SHA` and the boot sweep.

## Phase 3: routes, tools, pages

Branch `scrum-303-runner-surface`.

1. **Routes** under `src/app/api/admin/tests/`, all `withAdminRoute`:
   start, history, one run with filters, diff, cases. The directory-walk
   test from phase 1 now has real files to hold.
2. **The three built-ins**, `audience: "admin"`. `tests_run` declares
   `write`. `tests_results` defaults to non-passes, 100 a page, cursor.
   Tests: a non-admin sees none of the three and gets the unknown-tool
   answer for each by name; at most one of `tier` and `case_ids`; a second
   start returns the running id. The existing built-ins suite iterates the
   registry and calls every handler, so it would start a run. It is changed
   to call admin entries as an admin with the runner stubbed, and to assert
   the refusal for everyone else.
3. **Pages** under the guarded layout: index with start and history, run
   detail, diff. Polls while running. Confirm controls are portaled. The
   rail entry renders only when `/api/me` says admin.
4. **No plugin registry write and no classification snapshot change.** The
   snapshot is held to the plugin registry, which has no built-ins. Nothing
   pins the other direction today, so this phase adds the test: no
   `BUILT_IN_TOOLS` name appears in the snapshot.
5. **Docs.** Nothing public. These tools are not in the public tool counts,
   and a test pins that the public count excludes `audience: "admin"`.
6. **Skills.** `codebase-map` (runner flow), `gateway-dev` (how to add a
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

**Human step before 4b:** the `TEST_RUNNER_FIXTURES` value goes into the
parameter store and the compose `environment` list, verified with
`printenv` in the container. The value is never in the repo, a commit
message or a report in this repo.

Before 4d, one dry check on production: the guard refuses a send to any
address other than the reader, proven with a deliberate bad case run once
and then deleted.

## Phase 5: baseline and handover

1. Tier 1 against production, then a full run. Recorded as the baseline.
2. Three cases broken on purpose (a read, a round trip, a mail case), each
   must go red for its own reason, then restored. Until this is done the
   baseline is not trusted and SCRUM-289 stays held.
3. Report to HQ: run ids, totals, the uncovered list by name, leftovers.
4. HQ's side, not this repo's: point the daily box at `tests_run`, and mark
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

- **A run leaves an admin key alive.** Revoke by id in `finally`, a sweep
  at boot and at run start, and the key opens `/mcp` only.
- **A case mails a stranger.** The guard sits in `call`, covers all three
  recipient fields and the stored draft, and cases cannot name an account.
- **The probe writes something.** It never calls a write or an
  unclassified tool.
- **An admin path leaks its existence.** 404 for no session, wrong role,
  over-limit and a bearer credential; boundary match in the middleware; a
  directory walk so a new page cannot skip the guard.
- **A deploy mid-run.** The run dies, the row becomes `interrupted` at
  boot, the key is swept, stamped leftovers are reported by the next run.
- **`role` grows powers by accident.** A test pins that it does not lift
  the cap.

## Questions for the review of this plan

1. Phase 1 ships a placeholder admin page so the guard can be proven in
   production before anything sits behind it. Fine, or hold the page until
   phase 3?
2. The reply rule requires the original message to come from the reader
   mailbox. If today's reply cases answer a message the sender account
   sent to itself, those cases need the fixture thread seeded the other way
   round. Decide when batch 4d is planned, not now.
3. Batch order puts mail last. If the refactor needs mail coverage first,
   4d can move ahead of 4c at no cost.
