# One source of truth for the tool surface

**Status:** Design, **revised after the 2026-08-28 ruling** (recorded as accepted
in the company decision log). Not implemented. Nothing in this document
changes the running system.
**Date:** 2026-08-28 (first draft and revision, same day)
**Ticket:** SCRUM-172 — the ticket is the record; where this document and the
ticket disagree, the ticket wins and the disagreement should be flagged, not
reconciled silently.
**Owner:** Manuel (decision), gateway session (design)

## The ruling, and where it overrides this document's first draft

The first draft of this document argued from incident history and recommended
a particular ordering. Manuel ruled on principle and inverted it. Both are
recorded here so a later reader sees a disagreement that was resolved, not a
consensus that never existed.

| Question | First draft (evidence) | Ruling (principle) | Outcome |
|---|---|---|---|
| What is the `tools` table? | A cache of the plugin plus two policy columns | **The plugin is the source of truth for what EXISTS. The register is the source of truth for what is AVAILABLE TO A USER.** It holds state no plugin has an opinion about, and must not be judged as a mirror | Ruling. The table is a first-class thing, not a copy — and a future per-user access join table would hang off it, which is a further reason it stays a real table |
| Which leg is load-bearing? | The snapshot (it kept failing); the registry sync is lower urgency because the hand-run step has held 3-for-3 since 08-11 | **The sync is load-bearing.** A human standing in the middle of the chain means the plugin is not the source, only the first copy. The principle decides it, not the incident count | Ruling. The draft's evidence was not wrong — it is preserved below — but it answered "what fails" when the question was "what is the source" |
| What becomes of `registry-snapshot.ts`? | A generated, committed name file, refreshed by one command, so tests stay DB-free | **Deleted.** "We shouldn't need a back-office list; the menu should be the consumable interface." Both consumers read the register | Ruling. Verified: exactly two importers, both tests; nothing at runtime |
| Tests gaining a database dependency? | Avoided (a DB-free reading of the register) | **Accepted**, with the corollary that a DB-gated test that silently skips reports the passing value on failure, so skipping must become failing under validation | Ruling. `REQUIRE_DB=1` moves from bridge to design |
| `credits_per_call` | Preserved as policy, optionally seeded from the plugin manifest | **Dropped.** All 88 rows at default, nothing reads it, built ahead of a billing model that never arrived | Ruling |
| `enabled` | Preserved | **Kept** | Agreed |
| The soft-delete column | `retired_at` (draft's coinage) | **`deleted_at`** — soft-delete is the conventional name; a nullable timestamp, never a boolean | Amendment, same day. Name only; the semantics were already a timestamp and already separate from `enabled` |
| `read_only_hint` | A plugin fact, not gateway policy (disagreeing with the brief) | Verified from source and accepted | Draft's correction stands |
| Failure history by leg | Registry leg has held since 08-11; snapshot leg never had a checklist | Verified and accepted as a genuine re-weighting of the problem | Draft's correction stands; it does not change the ordering, see above |

Three mechanics the ruling settled, each with an incident behind it, are in
the design section and marked **(ruled)**.

## Recommendation

**Refactor, small, gateway-only, in this order:**

1. **The register is filled by the plugin process, on every start.** `startAll()`
   syncs each plugin's tools after its health check: UPSERT on
   `namespaced_name` refreshing **name, description and input schema** on every
   row, gateway-owned columns untouched, a vanished tool soft-deleted in its own
   column, and a hard refusal to act on a zero-tool answer. A plugin rollout is
   then exactly what it already has to be for the code to run — pull, build,
   restart — and the register learns as a consequence of the restart. "Code
   live in the container, invisible to every client" stops being a reachable
   state, and so does "same name, new shape, nobody can reach it".
2. **`registry-snapshot.ts` is deleted.** `KNOWN_READ_TOOLS` — the only
   non-derivable content — stays where it is, hand-written. The two tests that
   read the snapshot read the register. They become DB-gated, and under
   validation a DB-gated test that cannot reach a database **fails**.
3. **`credits_per_call` is dropped**, with the manifest's `pricing` slot and the
   dead credit-transaction enum that were built for the same model.

**Do not** drop the `tools` table, **do not** make the gateway import the plugin
package, and **do not** require the two repos to deploy together.

**Do the bridge now** regardless: the snapshot leg goes into the rollout
checklist for the weeks until this ships, because the third drift this month is
live as this is written.

## The state of the system today

Read from production on 2026-08-28, not from memory:

| | Rows | Enabled | `credits_per_call ≠ 1` | `enabled = false` | `read_only_hint IS NULL` |
|---|---|---|---|---|---|
| `atlassian-mcp` | 23 | 23 | 0 | 0 | 0 |
| `gws-mcp` | 65 | 65 | 0 | 0 | 0 |

**88 enabled tools in the register.** `registry-snapshot.ts` on this branch has
**87** — it lacks `gws-mcp__tasks_create_tasklist`. The `gws-mcp` checkout at
`main` serves **67**, two of which (`drive_rename_file`, `drive_copy_file`) are
deliberately unregistered pending a schema cleanup, because the current
procedure would write those rows twice.

Facts from that table the design rests on:

- **Every gateway-policy column is at its default on every row.** `enabled` is
  true everywhere. `credits_per_call` is 1 everywhere and, apart from the
  insert site, nothing reads it — hence the ruling to drop it.
- **`read_only_hint` is a plugin fact.** `plugin-manager.ts` copies the
  plugin's annotation into it at discovery, and the column's own comment says
  recorded-not-trusted. It is mirrored content, and the sync refreshes it like
  the other mirrored columns.
- **The plugin cannot ship a tool without an annotation.** `ToolDef` requires
  `annotations`, and `READ`/`CREATE`/`MUTATE` are the only ways to write one.
  The plugin's self-description is complete at the source, which is what makes
  deriving from it safe.

### What failed, by leg, with dates

Preserved from the first draft. It re-weights the *problem* — the ruling
accepted that — without changing the *ordering*, because the ordering is
decided by what the source of truth is, not by which copy last drifted.

| When | Leg | What happened |
|---|---|---|
| ≤ 2026-08-09 | register | Seven plugin tools never re-discovered; invisible to every user while the snapshot-vs-register check passed |
| 2026-08-11 | register | Runbook gains the mandatory "ask the plugin, diff both ways" leg |
| 2026-08-11 | register | `jira_delete_issue` rollout: leg run, row present |
| 2026-08-26 | register | Four Sheets tools (plugin commit 08-21) registered the day they rolled out |
| 2026-08-26 → 08-28 | **snapshot** | The same four Sheets tools absent from the snapshot; blocks a public skill page |
| 2026-08-28 | register | `tasks_create_tasklist` rollout: leg run, row present, plugin 65 = register 65 |
| 2026-08-28 | **snapshot** | Same rollout leaves the snapshot at 87 vs register 88 — hours after the Sheets fix on the same file |
| 2026-08-28 | register, **deliberately** | Two Drive tools live in the container, unregistered by decision: registering now and again after a schema cleanup means writing the rows twice |
| earlier | **register, shape not count** | `sheets_read` gained `value_render_option`; the plugin shipped it; no user could reach it; every count agreed throughout |

The hand-run register step has held three for three since it was made
mandatory. The ruling's answer: a step that holds is still a human in the
chain, and while a human is in the chain the plugin is not the source of truth
for what exists — it is the first copy. The last row is the one the ruling
added, and it is decisive on its own: no count-based check, manual or
automated, could have caught it.

## There are four artifacts, not three

| # | Artifact | Repo | Content | Hand-maintained? |
|---|---|---|---|---|
| 1 | `src/tools/*.ts` → `allTools` | plugin | name, description, schema, annotations | yes — **the source of truth for what exists** |
| 2 | `tools` table | gateway DB | (1) mirrored + `enabled` | mirrored part filled by a script a person runs; `enabled` is policy — **the source of truth for what is available** |
| 3 | `registry-snapshot.ts` | gateway source | `[name, "read"\|"write"]` for every register tool | yes |
| 4 | `KNOWN_READ_TOOLS` in `playground/tools.ts` | gateway source | the names allowed to run without approval | yes |

(3) and (4) are already pinned equal by a test — *KNOWN_READ_TOOLS is exactly
the snapshot's read set* — and the snapshot's classification column is pinned
equal to `classifyWrite(name)` on every row. So the snapshot's classification
column is **fully derivable** from (4) plus the verb rule, and what it adds
beyond (4) is only its list of names — a copy of (2). The artifact that drifted
three times this month is a hand-maintained copy of a database table, living in
a repository the table's writer never touches. The ruling's word for it is a
back-office list; the register is the menu.

(Further copies exist — the plugin READMEs' tool counts, pinned by a test in
the plugin repo; the gateway's docs and changelog pages, pinned by nothing. They
are prose about the surface rather than the surface. Out of scope.)

## The principle that decides it

> The plugin is the source of truth for what exists. The register is the
> source of truth for what is available to a user. Anything else that says
> which tools exist is a copy, and a copy is either derived by the event that
> changes its source or it is deleted.

The first draft's version of this — "a hand-maintained artifact in repo A
cannot be kept in sync with a deploy of repo B by any check in repo A" — is
still true and is the reason detection kept failing. But it argued from the
failure. The ruling argues from the role: a register that a person fills is
not a register of what the plugin offers, it is a register of what a person
last noticed the plugin offered. That distinction holds even on the days the
person gets it right, which is why the sync is load-bearing even though the
manual step has a clean record since 08-11.

## Design

### The register is filled by the plugin process, on every start

Today `discoverTools()` runs once, during `installAsync`. `startAll()` — what
runs on every gateway boot — spawns processes and stops. The hand-run
re-discovery script exists to do what `startAll()` declines to.

Change: after `spawnPlugin` + `waitForHealth`, both `startAll()` and
`installAsync` call `syncTools(serverId, slug, port)`. `discoverTools` is
deleted.

**Where it does NOT run:** the crash-respawn path (`child.on("exit")` →
`spawnPlugin`). A respawn runs the same checkout, so its tool set cannot have
changed, and a plugin in a crash loop is the textbook case of a process that
answers `ListTools` badly. Sync runs only behind a fresh `waitForHealth` on the
two deliberate paths.

`syncTools` semantics:

| Rule | Why |
|---|---|
| `listTools()` over the same Streamable HTTP transport the gateway already uses | Only the plugin is ground truth; this is the one call that asks it |
| **(ruled)** UPSERT on `namespaced_name` (already `UNIQUE`): on every row, existing or new, write `name`, `description`, `input_schema_json`, `read_only_hint`, `updated_at` — **the whole shape, not the row set** | A tool can keep its name and change its shape while every count stays still. `sheets_read` gained `value_render_option`, the plugin shipped it, no user could reach it, and all three counts agreed throughout. A sync that reconciles names reproduces that exactly |
| **Never touch `enabled` on an existing row** | The one policy column. It is the register's own opinion, and the plugin has none |
| **(ruled)** A row for this server absent from the plugin's answer is **soft-deleted**: `deleted_at = now()`. **Separate column from `enabled`.** `listUserToolRows` filters `enabled = true AND deleted_at IS NULL`; `/tools/[slug]` hides soft-deleted rows the same way | `enabled = false` means *we chose to hide this*; `deleted_at` means *the plugin no longer offers this*. Same visible result, opposite causes. Collapsed into one column, a re-enable resurrects a tool that no longer exists. Kept apart, a re-enable of a soft-deleted tool changes nothing, which is correct. **A nullable timestamp, not a boolean**: null is live; a value records *when* the plugin stopped offering the tool, which the alert needs and which separates a tool that vanished an hour ago from one that went months ago. A boolean throws that away for no saving |
| A soft-deleted tool that reappears is undeleted (`deleted_at = NULL`); `enabled` is whatever it was | Reversible by construction. This is what makes delete-and-reinsert unnecessary and removes the current "refuse to shrink" guard's reason to exist |
| **(ruled)** **A zero-tool answer aborts the sync for that server. Nothing is written.** Same for a transport error or a `listTools` that throws. Alert to Slack `alerts` | "Every tool was removed" and "the plugin is half-started, crashed, or answered before it finished loading" are indistinguishable by absence. A sync that trusted absence would soft-delete the entire surface while the gateway reported itself healthy. The guard is explicit, not implied by the health check |
| Any soft-delete is logged with the names and posted to Slack `alerts` | Soft-deleting is the only outcome that removes capability from a user, so it is the only one that must be impossible to miss. Both plugins answer `ListTools` from a static `allTools` array, so a *partial* answer is not possible today — see the falsification list for what changes if that stops being true |
| Record `mcp_servers.last_commit_sha` (`git rev-parse HEAD` in the checkout — the column exists and has never been written) and a new `mcp_servers.tools_synced_at` | The register then names *which plugin commit* it reflects, and *when it last asked*. Both are what every verification leg currently reconstructs by hand, and `tools_synced_at` is what the test-side freshness check reads |

What this removes from the runbook: the in-container script, the "refuse to
shrink" guard, the "no gateway restart is needed for the register" paragraph,
and the "Registration verification" leg's reason to exist. A plugin rollout
becomes: pull, build, restart, then the existing fresh-session check and the
tool's own acceptance case. The restart is the step that cannot be skipped,
because it is what makes the new code run at all.

It also removes the reason the two Drive tools are held unregistered: under
upsert, the schema cleanup landing later updates the rows in place.

**The failure mode it introduces, stated plainly:** a gateway restart now
writes the register. A plugin checkout that builds, boots, passes `/health` and
serves a wrong-but-non-empty list is reflected faithfully. That is the correct
behaviour — the register's job is to reflect what exists — but it moves the
review point from "before the INSERT" to "before the restart", which is where
the plugin's own test suite and the merge-first rule already sit. Nothing here
weakens the rule that a plugin is validated on merged `main` before it is
pulled into the container. A second exposure worth naming: a `git pull` run in
the container by hand and *not meant to ship* would be published by the next
restart. It would also be *executed* by the next restart today, so this is not
new — but it is worth saying that the checkout in the volume is now a
publishing surface, not only a runtime one.

### `registry-snapshot.ts` is deleted; the tests read the register

`KNOWN_READ_TOOLS` stays in `tools.ts`, hand-written, edited in a diff, with
the comments that explain the non-obvious calls (`gmail_mark_read`,
`gws_auth_setup`, `contacts_directory_search`) moved beside it from the
snapshot. The snapshot's write-side comments are all of the form "why this is
NOT a read", so they belong next to the read list too.

The snapshot's two consumers, rewired to the register (`tools ⋈ mcp_servers
WHERE status = 'active' AND enabled AND deleted_at IS NULL`):

- **`lib/skills.test.ts`** — a published skill may only name tools in the
  register. Same assertion, different source. Becomes DB-gated.
- **`tool-classification.test.ts`** — the DB-gated half already exists and
  stays: every register tool the plugin declares `readOnlyHint: true` is in
  `KNOWN_READ_TOOLS`, and nothing in `KNOWN_READ_TOOLS` is declared `false`.
  Two assertions move across from the DB-free half so they are not lost with
  the file: `KNOWN_READ_TOOLS ⊆ register` (a read allowlisted for a tool that
  does not exist is a typo waiting for a collision), and the withheld-tools
  pin (`gmail_create_filter` / `gmail_delete_filter` absent,
  `gmail_list_filters` present — both directions, as today).
- The "snapshot vs live register" test is deleted with the snapshot; the
  `registry-ground-truth.test.ts` (plugin vs register, `PLUGIN_MCP_URLS`-gated)
  stays as the in-container check and is now what the sync makes redundant on
  every restart.

**Dropped with the file:** the `[name, "write"]` entries. A tool not in
`KNOWN_READ_TOOLS` is a write; that is what fail-closed means, and the test
pinning `classifyWrite` against the snapshot has been proving for months that
the list adds nothing the classifier does not produce. The review with a
consequence is adding a *read*, and that review keeps its diff.

**(ruled) Tests gaining a database dependency is accepted**, with the
corollary designed in rather than left as a nicety:

- Every `describe.runIf(!!process.env.DATABASE_URL)` in the repo gains a
  top-of-file guard: if `REQUIRE_DB=1` is set and `DATABASE_URL` is not, the
  file **throws** at import. Merged-main validation runs the suite with
  `REQUIRE_DB=1`. A skipped guard then reads as red in the one place a skipped
  guard has been read as green.
- The freshness tripwire is rewritten to measure the subject: `max(
  mcp_servers.tools_synced_at)` within 14 days, instead of `usage_events`. A
  fresh fork of production passes the current tripwire while being a copy; it
  will fail this one as soon as production restarts, which it does on every
  gateway deploy. An empty or null result is a failure, never a pass.
- Which database: the one production uses, or a branch refreshed from it. The
  test says so in its failure message and names the command. This is the
  residual cost of the ruling — the local `.env`'s `DATABASE_URL` has been a
  stale branch before and will be again — and it is accepted because the
  alternative is a DB-free copy, which is the thing being deleted.

### `credits_per_call` is dropped

Migration drops `tools.credits_per_call`. With it go the two places that
promised it: `McpGatewayManifest.pricing.creditsPerCall` in `packages/types`
(never read) and `creditTransactionTypeSchema` in the same file (no table, no
reader). If a metered model arrives, it will not be per-tool-per-row anyway
— the plan caps in `billing/plans.ts` are per-plan, and Stage 2 is "metered
overage", not "priced tools".

### What stays hand-written, and why that is correct

| Artifact | Hand-written? | Justification |
|---|---|---|
| plugin `allTools` | yes | source of truth for what exists |
| plugin annotations | yes, compile-enforced | the plugin's own claim about itself, recorded not trusted |
| `KNOWN_READ_TOOLS` | yes | gateway policy: what runs unasked. Must never derive from anything the plugin controls |
| `tools.enabled` | yes, in the DB | the register's own opinion: what is available. The plugin has none |
| `tools` mirrored columns, `deleted_at` | **derived, at plugin start** | — |
| `registry-snapshot.ts` | **deleted** | — |
| `credits_per_call` | **deleted** | — |

## Where the derivation runs, and what each choice fails like

| Placement | What it would mean here | Failure mode | Verdict |
|---|---|---|---|
| **Build time** (plugin build emits a manifest the gateway reads) | `tsc` in the plugin writes `tools.json`; gateway reads it from the checkout | The build can succeed while the running process serves something else (a stale `server/` dir, a failed binary download). The gateway would trust a file about a process instead of the process | rejected; the running process is the truth |
| **Deploy time / process start** (the gateway asks the running plugin) | `syncTools` after health, on `startAll` and install | A plugin that boots wrong-but-non-empty is mirrored faithfully. Mitigated by health-before-sync, zero-answer refusal, soft delete, Slack alert. Moves the review point to before the restart, where the plugin's suite already sits | **chosen** |
| **Migration** (a drizzle migration inserts rows) | Tool rows as SQL in `packages/db/drizzle/` | Ties tool changes to gateway deploys — the lockstep the ticket forbids. Puts plugin facts under the gateway's migration journal, so a plugin rollback becomes a migration rollback | rejected |
| **On demand, committed** (`registry:pull` → a generated file) | The first draft's leg 3 | Stale until someone runs it; a back-office list by another name | rejected by ruling |

## Self-hosted and stdio deployments

Nothing changes, and the design must be checked against that on review.

A self-hosted `gws-mcp` (the `.mcpb` extension, or `node server/index.js`)
answers `tools/list` from `allTools` directly. There is no register, so there
is nothing to derive, and there never was drift there: the failure class this
ticket describes is a gateway phenomenon. Every change here is in the gateway
repo. The plugin does not learn that a register exists, gains no build step,
gains no dependency, and loses nothing — the manifest `pricing` slot being
removed was never read by anything, gateway included.

What a self-hoster does not get is `enabled` — they get every tool the plugin
serves. That is today's situation and it is correct: `enabled` is the *hosted*
product's opinion about availability, and a self-hoster is their own gateway.

## The cheap alternative, argued rather than dismissed

**"Do nothing structural; make the third step mandatory in the deploy path."**

The case for it was made in full in the first draft and is preserved because it
was accurate: an hour of work, no runtime change, and the same approach has
held three for three for the register leg since 2026-08-11. The snapshot leg
was never in the runbook, so the cheap fix was never tried on the artifact
that kept drifting.

Why it lost, in two parts — the draft's and the ruling's:

- *Draft:* for the snapshot, "mandatory" means a gateway commit and deploy per
  plugin rollout — lockstep by ritual, and the exact cost that produced the
  current drift when it was weighed and deferred on 2026-08-28. The deploy
  model is heading toward merge-triggered deploys, where there is no person to
  be mandatory for; the register leg's three-for-three is a record of people
  and does not transfer to a runner. And the gate that would enforce the step
  skips silently without a database.
- *Ruling:* none of that is the reason. The reason is that a checklist keeps a
  human in the chain, and a human in the chain means the plugin is not the
  source of truth for what exists. The checklist is the bridge, not the fix,
  even on the days it works.

## Other alternatives considered and rejected

- **Drop the `tools` table; serve `tools/list` from the plugins directly.**
  Rejected, and the ruling strengthens the rejection: the table holds
  `enabled`, which no plugin can hold, and it is what a future per-user
  access join table would join to. Also: every `ListTools` becomes a fan-out to
  N child processes, and a plugin that is down changes the advertised set
  instead of failing at call time.
- **Gateway takes the plugin as a pinned dependency and derives names from
  `allTools` at test time.** The plugin's install runs `download-binaries.sh`,
  so a git dependency drags a binary fetch into every gateway install; it
  couples `pnpm install` to a public repo's HEAD; and it does not touch the
  register, which is the leg that hides tools from users.
- **Plugin publishes `tools.json`; gateway trusts it.** Build-time placement,
  rejected above: a file about a process is not the process.
- **Make the classifier trust `readOnlyHint`.** Rejected without further
  argument: that trust was removed on purpose, and the column comment says why.
- **Keep the snapshot as a generated file.** The first draft's answer, rejected
  by ruling. It was a copy with a smaller blast radius, and a copy is still a
  back-office list.

## Rollout order — gateway only, no lockstep

1. **Migration**: add `tools.deleted_at timestamptz NULL` and
   `mcp_servers.tools_synced_at timestamptz NULL`; drop
   `tools.credits_per_call`. Additive except the drop, and the drop removes a
   column nothing reads.
2. **`syncTools`** replaces `discoverTools`; `startAll()` calls it after
   health; `listUserToolRows` and `/tools/[slug]` filter `deleted_at IS NULL`.
   Tested on the testcontainers harness: upsert refreshes description and
   schema on a row whose name did not change; upsert preserves `enabled =
   false`; an absent tool is soft-deleted and undeleted on return, `enabled`
   untouched either way; a zero-tool answer writes nothing and alerts; a
   transport error writes nothing; a second identical sync writes only
   `updated_at` and `tools_synced_at`; the crash-respawn path does not sync.
3. **Deploy the gateway.** On boot, `startAll` syncs both plugins. Expected
   effect on production: 88 rows refreshed in place (description/schema
   identical today, so only timestamps move), plus two new rows for the held
   Drive tools. Verify by reading `tools_synced_at`, `last_commit_sha`, and the
   row count.
4. **Delete `registry-snapshot.ts`**; rewire the two tests to the register;
   move the withheld-tools pin and the `⊆` check into the DB-gated block;
   consolidate the `KNOWN_READ_TOOLS` comments; add the `REQUIRE_DB` guard to
   every DB-gated file; rewrite the freshness tripwire; drop the dead types in
   `packages/types`.
5. **Runbooks and skills** (same commit as 4, freshness rule): delete the
   in-container script and the verification leg from `ops-debugging`; the
   `gws-mcp-dev` ship tail's step 3 becomes "if the tool is a read, add it to
   `KNOWN_READ_TOOLS`"; the deploy skill's "if tools changed" note goes; the
   validate step in the rollout checklist runs with `REQUIRE_DB=1`; the
   `codebase-map` bullets on `startAll`/`discoverTools` are rewritten.

Steps 1–3 must precede 4: once the snapshot is gone the tests read the
register, and the register must already be the thing the plugin fills.

No step requires a plugin change. No step requires the two repos to deploy in
any order.

## Bridge — until step 3 ships

Add the snapshot leg to the rollout checklist as the third system, in words
that say it is a gateway commit. This is the cheap option, it is the right
thing for the weeks between now and the deploy, and it is removed by step 4.

## What would change this design — re-checked against the ruled shape

The ruling makes the sync load-bearing, so each item below was re-verified
today rather than carried forward. **None fires.** Stakes are stated because
they are higher than in the first draft.

- **A plugin whose `ListTools` is dynamic or partial at boot.** Both plugins
  export a static `allTools` (`gws-mcp` flattens a module list; `atlassian-mcp`
  spreads two arrays) and answer `ListTools` from it, so an answer is either
  complete or absent, and absence is refused. **Does not fire.** If a plugin
  ever registers tools lazily, the zero-answer guard is no longer sufficient:
  the soft-delete rule must then require the same absence on two consecutive syncs.
  Design that in before such a plugin is installed, not after.
- **A second gateway instance.** Production compose runs one `gateway`
  service; the `deploy` block is a memory limit, not replicas. **Does not
  fire.** Two instances syncing one server row is fine for upserts and a race
  for soft-deletes; horizontal scaling would need a per-server advisory lock or the
  sync moved out of `startAll` into a single job.
- **A hot-reload path for plugins.** The only respawn is crash-recovery, which
  runs the same checkout and is deliberately excluded from sync. **Does not
  fire.** If a reload-in-place path appears, sync must move with it, behind a
  health wait, or the register lags the code — the exact state the ruling
  forbids.
- **The meta-tool migration** (`2026-04-22-meta-tool-migration.md`) landing
  within a month. It reshapes what the register *is*; fold this into it rather
  than shipping ahead if the two are that close. No date on it today.
- **`enabled` being wanted per-user.** The deferred join table. It hangs off
  the register and does not change this design; named so nobody reads
  `enabled` as the last word on availability.

## Where this document still disagrees, or wants to

Recorded per instruction, so it is argued now rather than discovered in code
review.

- **Zero-only refusal is the right hard guard today and will not be tomorrow.**
  The ruling names zero. This document agrees because a partial answer is
  impossible from either current plugin, and refusing on "fewer than before"
  would make a genuine removal need a manual override. But the guard is
  correct *because of* a property of the plugins, not of the sync; the
  falsification item above is the standing note that the guard has a
  precondition.
- **Deleting the snapshot deletes the DB-free half of the safety net.** The
  ruling accepts DB-gated tests; this document agrees and designed `REQUIRE_DB`
  in. The residual it wants named: on a laptop without a database, `pnpm
  vitest run` no longer says anything about skills naming real tools or about
  `KNOWN_READ_TOOLS` naming real tools. Validation catches both. A contributor
  without production credentials does not. That is the price, and it is
  accepted.
- **The ordering.** This document's evidence — the register leg holding since
  08-11, the snapshot leg never having a checklist — is intact and recorded
  above. The ruling's answer is a principle, and the document accepts that a
  principle outranks an incident count when the two point different ways,
  because the incident count describes the past month and the principle
  describes the system. The disagreement is preserved so that if the sync ever
  proves harder to keep unskippable than the checklist was, whoever revisits
  this can see that the checklist's record was known and was set aside on
  purpose.

## Out of scope, explicitly

- The plugin READMEs' tool counts and the gateway docs/changelog prose.
- A per-user tool access join table (deferred by ruling; the register is what
  it would join to).
- Serving `ListTools` per-user from anything but the register.
- Any change to `classifyWrite`, the verb rule, or the fail-closed default.
- CI. Everything above works with a person typing the command; it gets
  strictly better, not different, when a runner types it.
