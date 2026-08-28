# One source of truth for the tool surface

**Status:** Design for review — not implemented. Nothing in this document changes
the running system.
**Date:** 2026-08-28
**Ticket:** SCRUM-172 — the ticket is the record; where this document and the
ticket disagree, the ticket wins and the disagreement should be flagged, not
reconciled silently.
**Owner:** Manuel (decision), gateway session (design)

## Recommendation, first

**Refactor, but a small one, only on the gateway side, and the two legs do not
carry equal weight.** In order of conviction:

1. **`registry-snapshot.ts` stops describing the plugin.** This is the leg that
   has failed every time since the registry leg was fixed, and it is the leg
   whose "mandatory step" version costs a gateway deploy per plugin rollout —
   the lockstep the ticket forbids, and which the team is already declining to
   pay (the current drift is a dated decision to wait, not an omission). The
   only content in the file that is not derivable is the reviewed read
   allowlist, and that already lives in `KNOWN_READ_TOOLS`. The name universe
   the tests need becomes a generated, committed file that one command
   refreshes from the registry. It can still go stale — but staleness there can
   no longer hide a tool from a user, and refreshing it never needs a deploy.
2. **The registry becomes a cache that the plugin process fills every time it
   starts.** `startAll()` re-discovers tools after each plugin's health check,
   with UPSERT semantics keyed on `namespaced_name`, so the gateway-owned
   columns survive and a tool that disappears is retired, not deleted. Honest
   framing: **the hand-run version of this step has held on every rollout since
   it was made mandatory on 2026-08-11.** The case for automating it is not
   that the ritual fails; it is that the ritual is a script pasted into a
   container, that the deploy model is moving toward merge-triggered deploys
   where there is no one to paste it, and that delete-and-reinsert is what makes
   re-registering a tool cost a rewrite (the reason two Drive tools are held
   unregistered right now). Lower urgency than (1); could ship second.

**Do not** drop the `tools` table, **do not** make the gateway import the plugin
package, and **do not** require the two repos to deploy together. The table is a
fine cache; the defect is that a human fills it.

**Also do the cheap thing now**, before any of the above is approved: put the
snapshot leg into the rollout checklist, and make the DB-gated suites fail
loudly (not skip) in the validate step. Section "Bridge" below. It costs an
hour, it does not conflict with the refactor, and the third drift this month is
live as this is written.

## The state of the system today

Read from production on 2026-08-28, not from memory:

| | Rows | Enabled | `credits_per_call ≠ 1` | `enabled = false` | `read_only_hint IS NULL` |
|---|---|---|---|---|---|
| `atlassian-mcp` | 23 | 23 | 0 | 0 | 0 |
| `gws-mcp` | 65 | 65 | 0 | 0 | 0 |

So: **88 enabled tools in the registry.** `registry-snapshot.ts` on this branch
has **87** — it lacks `gws-mcp__tasks_create_tasklist`. The `gws-mcp` checkout at
`main` serves **67**, two of which (`drive_rename_file`, `drive_copy_file`) are
deliberately unregistered pending a schema cleanup, because the current
procedure would write those rows twice.

Three facts in that table matter for the design:

- **Every gateway-policy column is at its default on every row.** `enabled` is
  true everywhere; `credits_per_call` is 1 everywhere and, apart from the
  insert site, **nothing in the gateway reads it**. The ticket's constraint
  ("the registry row is not merely a mirror") is a constraint on the *schema*,
  not on any *data* that exists. That does not make it wrong — a design that
  cannot carry policy is a regression waiting for the first non-default row —
  but it means the design can be judged on whether it *preserves* those columns,
  not on whether it can *reconstruct* them.
- **`read_only_hint` is not gateway policy.** It is the plugin's own annotation,
  captured at discovery, and its schema comment says so: recorded, not trusted.
  It belongs with the mirrored columns, not the policy ones. The ticket lists it
  alongside `credits_per_call` and `enabled`; that grouping is the one thing in
  the brief this document disagrees with.
- **The plugin already cannot ship a tool without an annotation.** `ToolDef`
  requires `annotations` and the three named shapes (`READ`/`CREATE`/`MUTATE`)
  are the only way to write one; an omission is a compile error. So the plugin's
  self-description is complete at the source, which is what makes deriving from
  it safe.

### What failed, by leg, with dates

The ticket counts three failures this month. Separated by which artifact
drifted, they tell a different story from "detection fails":

| When | Leg | What happened |
|---|---|---|
| ≤ 2026-08-09 | registry | Seven plugin tools never re-discovered; invisible to every user while the snapshot-vs-registry check passed |
| 2026-08-11 | registry | Runbook gains the mandatory "ask the plugin, diff both ways" leg |
| 2026-08-11 | registry | `jira_delete_issue` rollout: leg run, row present |
| 2026-08-26 | registry | Four Sheets tools (plugin commit 08-21) registered the day they rolled out |
| 2026-08-26 → 08-28 | **snapshot** | The same four Sheets tools absent from the snapshot; blocks a public skill page |
| 2026-08-28 | registry | `tasks_create_tasklist` rollout: leg run, row present, plugin 65 = registry 65 |
| 2026-08-28 | **snapshot** | Same rollout leaves the snapshot at 87 vs registry 88 — hours after the Sheets fix on the same file |
| 2026-08-28 | registry, **deliberately** | Two Drive tools live in the container, unregistered by decision: registering now and again after a schema cleanup means writing the rows twice |

**The registry leg has held three for three since it was made mandatory.** The
snapshot leg was never in the runbook, and the one time its update was
consciously weighed, the answer was to wait, because each update is a gateway
deploy. That is the design's most important input: the failing leg is the one
whose fix-by-checklist has a cost people are visibly unwilling to pay.

## There are four artifacts, not three

The ticket names three. There is a fourth, and it changes the analysis:

| # | Artifact | Repo | Content | Hand-maintained? |
|---|---|---|---|---|
| 1 | `src/tools/*.ts` → `allTools` | plugin | name, description, schema, annotations | yes — **this is the source** |
| 2 | `tools` table | gateway DB | mirror of (1) + `enabled`, `credits_per_call` | filled by a script a person runs |
| 3 | `registry-snapshot.ts` | gateway source | `[name, "read"\|"write"]` for every registry tool | yes |
| 4 | `KNOWN_READ_TOOLS` in `playground/tools.ts` | gateway source | the names allowed to run without approval | yes |

(3) and (4) are already pinned equal by a test: *KNOWN_READ_TOOLS is exactly the
snapshot's read set.* And the snapshot's classification column is pinned equal
to `classifyWrite(name)` for every row. Put those two facts together and the
snapshot's **entire classification column is derivable** from (4) plus the verb
rule — the test proves it on every run. What the snapshot adds beyond (4) is
only its **list of names**, i.e. "which tools a human has looked at", and that
list is a copy of (2).

Which is the whole point: the artifact that drifted three times this month is a
hand-maintained copy of a database table, living in a repository that the
database's writer never touches.

(There are further copies — the plugin READMEs' tool counts, pinned by a test
in the plugin repo; the gateway's docs and changelog pages, pinned by nothing.
They are prose about the surface rather than the surface, and out of scope here
except where noted.)

## The principle that decides it

> A hand-maintained artifact in repo A cannot be kept in sync with a deploy of
> repo B by any check that lives in repo A.

Detection has been tried three times and failed three times, and the ticket's
diagnosis of why is exactly right: the gate is not skipping, it is absent — it
runs in a repository that is not in the room when the plugin ships. No amount of
"mandatory" fixes that, because mandatory is a property of a checklist and the
checklist is the thing that was not in the room either.

So for each artifact there are only two honest options:

- **Generate it in the deploy path that changes its source.** Then drift cannot
  ship, because the same event that changes the source rewrites the copy.
- **Make it stop describing the other repo.** Then there is nothing to drift.

Leg 2 gets the first. Leg 3 gets the second. Anything else is a fourth
detection scheme.

## Design

### Leg 2 — the registry is filled by the plugin process, on every start

Today `discoverTools()` runs once, during `installAsync`. `startAll()` — what
runs on every gateway boot — spawns the processes and stops. The hand-run
re-discovery script exists to do what `startAll()` declines to.

Change: after `spawnPlugin` + `waitForHealth` in `startAll()`, call a new
`syncTools(serverId, slug, port)`. `installAsync` calls the same function.
`discoverTools` as it exists is deleted.

`syncTools` semantics, each a deliberate departure from the current
delete-and-reinsert:

| Rule | Why |
|---|---|
| `listTools()` over the same Streamable HTTP transport the gateway already uses | Only the plugin is ground truth; this is the one call that asks it |
| UPSERT on `namespaced_name` (it is already `UNIQUE`): write `name`, `description`, `input_schema_json`, `read_only_hint`, `updated_at`; **never touch `enabled` or `credits_per_call` on an existing row** | The policy columns are gateway-owned. Preserving them is what makes "derive the table from the plugin" not naive. |
| Rows for this server absent from the plugin's list are **retired**, not deleted: `retired_at = now()`, and `listUserToolRows` adds `retired_at IS NULL` to its filter | Reversible. The next sync that sees the tool again clears `retired_at`. A delete is what makes the current script need its "refuse to shrink" guard; a soft retire needs no guard because nothing is lost |
| A retire is logged and posted to the Slack `alerts` channel with the tool names | Retiring is the only outcome that removes capability from users, so it is the only one that must be impossible to miss. The plugin's `ListTools` answers from a static array, so a half-started server cannot answer short — but the cost of the notification is one line |
| Zero tools from a healthy plugin aborts the sync for that server and alerts | The one case where "the plugin said so" should not be believed |
| Record `mcp_servers.last_commit_sha` (`git rev-parse HEAD` in the checkout — the column exists and is never written) and a new `tools_synced_at` | The registry then says *which plugin commit* it reflects, which is the fact every verification leg currently has to reconstruct by hand |
| New rows seed `credits_per_call` from `manifest.pricing.creditsPerCall[name]` when the plugin's `datatorag.json` declares one, else 1 | The manifest type already has the slot. The plugin may *propose*; the gateway row remains the policy and a later manual edit is never overwritten. Optional — not required for the drift fix |

What this removes from the runbook: step 3 (the in-container script), the
"refuse to shrink" guard, the "no gateway restart is needed for the registry"
paragraph, and the entire "Registration verification" leg's reason to exist.
The plugin rollout becomes: pull, build, restart, then the existing fresh-session
check and the tool's own acceptance case. The restart is the one step that
cannot be skipped, because it is what makes the new code run at all.

What it also removes: the reason the two Drive tools are currently held
unregistered. Under upsert the schema cleanup landing later just updates the row
in place; there is no "written twice" cost and no intentional half-state that
looks like the accidental one.

**The failure mode it introduces, stated plainly:** a gateway restart now writes
to the registry. A plugin checkout that builds, boots, passes `/health` and then
serves a wrong list will be reflected faithfully. That is the correct behaviour
— the registry's job is to reflect the plugin — but it moves the review point
from "before the INSERT" to "before the restart", which is where the plugin's
own test suite and the merge-first rule already sit. Nothing about this design
weakens the rule that a plugin is validated on merged `main` before it is pulled
into the container.

### Leg 3 — the snapshot stops describing the plugin

Split `registry-snapshot.ts` into what it actually is:

**Kept, hand-written, gateway policy:** `KNOWN_READ_TOOLS`. This is the only
non-derivable content in the current snapshot: the reviewed set of names that
run without approval. It stays in `tools.ts`, and it stays a list a human edits
in a diff, with the comments that explain the non-obvious calls
(`gmail_mark_read`, `gws_auth_setup`, `contacts_directory_search`) moved to sit
beside it. The write-side rationale comments in the snapshot today are all of
the form "why this is NOT a read", so they belong next to the read list too.

**Replaced by a generated file:** `registry.generated.json`, committed to the
gateway repo, produced by `pnpm registry:pull` (a script under
`apps/gateway/scripts/`) from the `tools` ⋈ `mcp_servers` query the DB-backed
test already runs. Per server: `slug`, `last_commit_sha`, `tools_synced_at`, and
per tool: `namespaced_name`, `read_only_hint`. No descriptions or schemas — the
file is a name universe, not a second registry. Sorted, so a new tool is an
insertion.

Its readers, all tests, none of which need a database:

- `lib/skills.test.ts`: a published skill may only name tools in the file.
  Unchanged in purpose; the import changes.
- `tool-classification.test.ts`, DB-free half:
  `KNOWN_READ_TOOLS ⊆ file.names` (a read allowlisted for a tool that does not
  exist is a typo waiting for a collision), and the cross-check that today needs
  a database — *every tool the plugin declares `readOnlyHint: true` is in
  `KNOWN_READ_TOOLS`, and nothing in `KNOWN_READ_TOOLS` is declared `false`* —
  now runs from the file on every laptop.
- `tool-classification.test.ts`, DB-backed half: the file equals the query,
  including `last_commit_sha`. This is the staleness check, and it stays
  DB-gated — see "Bridge" for making the gate fail instead of skip.

**Dropped:** the `[name, "write"]` half of the snapshot. A tool that is not in
`KNOWN_READ_TOOLS` is a write; that is what fail-closed means, and the test that
pins `classifyWrite` against the snapshot has been proving for months that the
list adds no information the classifier does not already produce. What the
write entries were for — "a human agreed this prompts" — is a review with no
consequence: the tool prompts whether or not the entry exists. The review that
*has* a consequence is adding a read, and that review keeps its diff.

**Why "generated and committed" rather than "read the DB in the test":** the
ticket's constraint — readable without a database — is right, and for a reason
beyond convenience: a DB-gated skills test would skip on a machine without
`DATABASE_URL`, and a skipped guard on public content reads as a pass. The file
is the DB-free reading. It is a copy, and copies drift; the question is what the
drift costs, and here it costs one thing only: a skill page that names a tool
newer than the file fails its test until the author runs `pnpm registry:pull`.
The author has the credentials (the same root `.env` the dev server reads), the
command is one line, and the failure message names it. Compare the current
cost: the same drift blocked a public page for nineteen days because fixing it
meant hand-editing a review record.

**Where it cannot help, stated honestly:** this leg stays *detectable*, not
*impossible*. A gateway source file cannot be rewritten by a plugin rollout;
the design accepts that and makes the file's staleness harmless to users
instead. If a future reader wants leg 3 to be impossible too, the only route is
to have the skills test read the registry directly, which trades the DB-free
property away — and the ticket ruled that out for good reasons.

### What stays hand-written, and why that is correct

| Artifact | Hand-written? | Justification |
|---|---|---|
| plugin `allTools` | yes | it is the source |
| plugin annotations | yes, compile-enforced | the plugin's own claim about itself |
| `KNOWN_READ_TOOLS` | yes | gateway policy: what runs unasked. Must never be derived from anything the plugin controls |
| `tools.enabled`, `tools.credits_per_call` | yes, in the DB | gateway policy per tool; preserved, never regenerated |
| `tools` mirror columns | **derived, at plugin start** | — |
| `registry.generated.json` | **derived, on demand, staleness-tested** | — |
| `registry-snapshot.ts` | **gone** | — |

## Where the derivation runs, and what each choice fails like

The ticket asks for the failure mode of each placement to be named, because
they differ.

| Placement | What it would mean here | Failure mode | Verdict |
|---|---|---|---|
| **Build time** (plugin build emits a manifest the gateway reads) | `tsc` in the plugin writes `tools.json`; gateway reads it from the checkout | The build can succeed while the running process serves something else (a stale `server/` dir, a failed binary download). The gateway would trust a file about a process instead of the process. The plugin repo has already met a variant of this: a build that no-ops in a persistent checkout and looks green | rejected for leg 2; the running process is the truth |
| **Deploy time / process start** (the gateway asks the running plugin) | `syncTools` after health, on every start | A plugin that boots wrong is mirrored faithfully. Mitigated by health-before-sync, zero-tools abort, soft retire, Slack alert. Moves the review point to before the restart, where the plugin's own suite already sits | **chosen for leg 2** |
| **Migration** (a drizzle migration inserts rows) | Tool rows as SQL in `packages/db/drizzle/` | Ties tool changes to gateway deploys — the lockstep the ticket forbids. Also puts plugin facts under the gateway's migration journal, so a plugin rollback becomes a migration rollback | rejected |
| **On demand, committed** (`registry:pull`) | The generated JSON | Stale until someone runs it. Acceptable only because its readers are tests of gateway-authored content, not the serving path | **chosen for leg 3** |

## Self-hosted and stdio deployments

Nothing changes, and the design must be checked against that on review.

A self-hosted `gws-mcp` (the `.mcpb` extension, or `node server/index.js` with a
stdio or HTTP transport) answers `tools/list` from `allTools` directly. There is
no registry, so there is nothing to derive, and there never was drift there: the
entire failure class this ticket describes is a gateway phenomenon. The design
keeps it that way by placing every change in the gateway repo. The plugin does
not learn that a registry exists, does not gain a build step, does not gain a
dependency, and the optional `pricing.creditsPerCall` block in `datatorag.json`
is already part of the manifest type and is ignored by anything that is not the
gateway.

What a self-hoster does not get is `enabled` and `credits_per_call` — they get
every tool, unmetered. That is the situation today and it is correct: those
columns are *our* policy for *our* hosted product.

## The cheap alternative, argued rather than dismissed

**"Do nothing structural; make the third step mandatory in the deploy path."**

Concretely: add "update `registry-snapshot.ts`, run `tool-classification`
against production, merge and deploy the gateway" to the plugin rollout
checklist, and get `PLUGIN_MCP_URLS` into the container so the ground-truth test
can run there.

The case for it is stronger than the ticket allows, and it should be said
plainly:

- It is an hour of work against a day or two, with no runtime change and no
  rollback risk.
- **The same approach has already worked for the registry leg.** Since the
  "ask the plugin" leg was made mandatory on 2026-08-11, three rollouts have
  run it and three registries came out right. "Detection has failed three
  times" is true of the period *before* that leg existed and of the *snapshot*
  leg, which never had one.
- The snapshot leg was **never in the runbook**. The cheap fix has not been
  tried on the artifact that keeps drifting.

The case against it, which is why it is the bridge and not the answer:

- For the snapshot, "mandatory" means **a gateway commit and deploy per plugin
  rollout**. That is lockstep by ritual — not enforced, just required — and the
  ticket names lockstep as a regression. It is also the cost that produced the
  current drift: on 2026-08-28 the update was weighed and deferred *because* it
  meant a second gateway deploy for one logical change. A step people decline
  on cost grounds while looking straight at it is not a step a checklist will
  hold.
- The deploy model is heading toward **merge-triggered deploys**. A
  merge-triggered plugin deploy has no person in the loop to open the gateway
  repo. Under that model the mandatory step has nobody to be mandatory *for*.
  The registry leg's three-for-three record is a record of people; it does not
  transfer to a runner.
- The gate that would enforce the snapshot step (`tool-classification.test.ts`)
  fails silently without `DATABASE_URL`, and passes wrongly against a fresh
  database branch — its own freshness tripwire measures `usage_events` and
  draws a conclusion about `tools`. So even a rollout that remembers the step
  can get a green that means nothing.

The honest summary: for the registry, the checklist works and the refactor is
about the deploy model and the rewrite cost, not about failure. For the
snapshot, the checklist's price is a deploy, the team has already shown it will
not pay it, and structure — making the file's staleness free — is the only
thing that removes the price.

## Other alternatives considered and rejected

- **Drop the `tools` table; serve `tools/list` from the plugins directly.**
  Removes leg 2 entirely. Rejected: it makes every `ListTools` a fan-out to N
  child processes; a plugin that is down changes the advertised tool set instead
  of failing at call time; `enabled` and `credits_per_call` need a home anyway;
  the `/tools/[slug]` pages and the home-page grid read the table. An in-memory
  list populated at start is the same as the proposed sync minus persistence.
  The table is not the problem.
- **Gateway takes the plugin as a pinned dependency and derives names from
  `allTools` at test time.** Genuinely tempting — the pin becomes the one
  declaration of "which plugin the gateway believes it serves". Rejected: the
  plugin's install runs `download-binaries.sh`, so a git dependency drags a
  binary fetch into every gateway install; it couples the gateway's `pnpm
  install` to a public repo's HEAD; and it does not touch leg 2, which is the
  leg that hides tools from users.
- **Plugin publishes `tools.json`; gateway trusts it.** Build-time placement,
  rejected above: a file about a process is not the process.
- **Make the classifier trust `readOnlyHint`.** Removes `KNOWN_READ_TOOLS`
  entirely. Rejected without further argument: that trust was removed on
  purpose, and the schema comment on the column says why.

## Rollout order — gateway only, no lockstep

1. **Migration**: add `tools.retired_at timestamptz NULL` and
   `mcp_servers.tools_synced_at timestamptz NULL`. Additive, no backfill.
2. **`syncTools`** replaces `discoverTools`; `startAll()` calls it after health;
   `listUserToolRows` filters `retired_at IS NULL`. Tested against the
   testcontainers harness: upsert preserves a non-default `credits_per_call`
   and `enabled = false`; an absent tool is retired and un-retired on return;
   zero tools aborts; a second sync with no changes writes only `updated_at`.
3. **Deploy the gateway.** On boot, `startAll` syncs both plugins. Expected
   effect on production: zero changes to the 88 existing rows beyond
   `updated_at`, plus two new rows for the held Drive tools (their schema will
   be updated in place when the cleanup lands — the reason for holding them is
   gone). Verify by reading `tools_synced_at` and the row count.
4. **`registry:pull` + `registry.generated.json`**, tests rewired,
   `registry-snapshot.ts` deleted, `KNOWN_READ_TOOLS` comments consolidated.
   Pure gateway source change; ships in the same or a later gateway deploy.
5. **Runbooks**: delete the in-container script and the verification leg from
   `ops-debugging`; the `gws-mcp-dev` ship tail's step 3 becomes "if the tool is
   a read, add it to `KNOWN_READ_TOOLS`; if a skill page will name it, run
   `pnpm registry:pull`"; the deploy skill's "if tools changed" note goes. Same
   commit as step 4 (freshness rule).

No step requires a plugin change. No step requires the two repos to deploy in
any order. Steps 4–5 (the snapshot leg) do not depend on steps 1–3 and should
ship first, per the recommendation; the generated file simply carries a null
`last_commit_sha` until step 2 starts writing it.

## Bridge — do these now regardless of the decision

Neither conflicts with the design; both are worth having even if the design is
rejected.

1. **Add the snapshot leg to the rollout checklist** as the third system, in
   words that say it is a gateway commit. This is the cheap option, and it is
   the right thing to do for the weeks between now and an approved refactor.
2. **`REQUIRE_DB=1` for the validate step.** Every `describe.runIf(!!process.env.DATABASE_URL)`
   becomes `describe.runIf(...)` plus a top-of-file assertion that throws when
   `REQUIRE_DB` is set and the URL is not. The merged-main validation runs with
   `REQUIRE_DB=1`. A skipped guard then reads as a failure in the one place a
   skipped guard has been read as a pass. (Alternatively vitest's
   `--pass-with-no-tests=false` posture per file — the mechanism matters less
   than the property: under validation, skipped is red.)
3. **Fix the freshness tripwire** to measure the thing it draws conclusions
   about: compare `max(tools.updated_at)` against the plugin repo's `main`
   commit date, or — once `last_commit_sha` is written — compare the sha itself.
   A fresh fork of production currently passes the tripwire while being a copy,
   which is the exact case it was written for.

## What would change this recommendation

State what evidence would talk the author out of it, so the review can look for
that evidence rather than for agreement:

- **A plugin whose `ListTools` is dynamic or partial at boot.** Both current
  plugins answer from a static array, which is what makes "sync after health"
  safe. A plugin that registers tools lazily, or answers before it is fully up,
  would need the sync to wait on something stronger than `/health`, or the
  retire rule to need two consecutive observations. If such a plugin is planned,
  the retire rule should be designed for it now.
- **A second gateway instance.** Two processes syncing the same server row on
  restart is fine for upserts and a race for retires. Single instance today; if
  horizontal scaling is on the roadmap, the sync needs an advisory lock per
  server or moves out of `startAll` into a job.
- **The meta-tool migration** (`2026-04-22-meta-tool-migration.md`) landing
  soon. It reshapes what the registry *is*; this design should be folded into
  it rather than shipped ahead of it if the two are within a month of each other.
- **Evidence that people would skip the restart.** The whole leg-2 argument
  rests on the restart being unskippable because it is what makes new code run.
  If a hot-reload path for plugins appears, the sync must move with it.
- **A reason `credits_per_call` should be a plugin fact.** If the manifest's
  pricing block is ever meant to be authoritative, the policy column is not a
  policy column, and the table becomes a pure mirror — at which point "drop the
  table" deserves a second look.

None of these is present today. If one turns up during review, the answer is to
adjust the retire rule or the placement, not to fall back to the checklist.

## Out of scope, explicitly

- The plugin READMEs' tool counts and the gateway docs/changelog prose: still
  hand-maintained, still only partially pinned. A separate, smaller ticket.
- Serving `ListTools` per-user from anything but the registry.
- Any change to `classifyWrite`, the verb rule, or the fail-closed default.
- CI. Everything above is designed to work with a person typing the command,
  because that is the environment; it gets strictly better, not different, when
  a runner types it instead.
