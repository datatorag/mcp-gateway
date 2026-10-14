# SCRUM-423: production registry writes through the pipeline

Status: spec for review. Nothing here is built: no workflow, no secret, no database role.

## Problem

A production change to the `tools` registry is a guarded SQL file, run once, on a person's
go. Today the run needs a laptop: the second confirmation is a local action that only works on
the machine the change is prepared on. From a phone it cannot be given.

Deploys already solved the same problem. `release.yml` waits on the `production` environment,
and the environment's approval can be given from the GitHub mobile app. This spec moves
production registry writes to that shape.

Schema migrations are out of scope. They keep their own flow.

## What exists, read at `8316501`

- `.github/workflows/release.yml` and the SCRUM-394 spec: a `request` job with no secret and no
  environment computes what will be sent and prints it; a `deploy` job on `environment:
  production` holds the secrets and runs only after approval. Runs are from `main` only. Inputs
  reach scripts through `env`, never through `${{ }}` in a `run` line. Actions are GitHub's own,
  pinned to a commit. `permissions: {}` at the top.
- SCRUM-394, section 6: the approval is a record, not a control. It shows an allowed account
  approved, not that a person did. The control is a person saying go, in words.
- `scripts/registry-diff.mjs`: from the tool files CI keeps for two gateway commits, writes a
  forward and a rollback file. Each is one transaction: `BEGIN`, `SET LOCAL
  standard_conforming_strings = on`, one `DO $registry_change$` block, a read of the touched rows,
  `COMMIT`. Inside the block every statement touches one row of `tools`, joined to `mcp_servers`
  by slug: an `UPDATE` or `DELETE` guarded by the md5 of the row's description and of its
  `input_schema_json::text`, an `INSERT` guarded by `NOT EXISTS`. Each is followed by `GET
  DIAGNOSTICS` and a raise unless exactly one row moved. The block ends with a count of the
  plugin's rows, and raises unless it is the count the other commit served. It trusts a tool
  file only from a build run on `main`, and it opens no database connection.
- `build.yml` keeps each published image's plugin tool files as an artifact of the run.
- The drift check (runner case A4) compares, by name, what each plugin serves, what the registry
  holds and what the gateway lists. It runs inside the gateway process, because only from there
  can it ask each plugin directly.
- The host is reached by one SSH key, forced to one command (`scripts/host-deploy.sh`) that
  validates its one line of input. The key, the host's address and its pinned key are secrets of
  the `production` environment.

## Rule

A production registry change is a file that `registry-diff` produced, or one in exactly its
shape. A workflow checks the file, shows it and its sha256 to the reviewer, waits for the
`production` environment's approval, then runs it in one transaction against the production
database as a role that can change only the registry. It prints the rows the change touched.

## 1. The workflow

`registry.yml`, `workflow_dispatch`, two jobs in `release.yml`'s shape.

### What is run: three ways to say it

| Input | For | Against |
|---|---|---|
| A. A path in the repo at a named sha on `main` | The file was reviewed in a pull request, and the sha pins it | The file has to be committed first, so a change needs a PR before it can run |
| B. The SQL itself, as an input | Nothing to commit | No review trail; dispatch inputs are limited in size, and a registry file carries every changed tool's description and schema; easy to paste the wrong file |
| C. `(slug, from, to)`, generated in the job | Nobody transcribes SQL. The file is by construction the generator's output, from CI's own records | Needs the build records of both commits; cannot express a change that is not a diff between two builds |

**Recommendation: C as the normal path, A for the rest.** Almost every registry change is the
difference between what two gateway builds serve, and C produces it without a person or a
session in between. A covers what C cannot: a change that is not a build diff (a row put back
by hand, a correction). B is not offered.

Both go through the same check (section 2), so A is held to the generator's shape too.

### Inputs

| Input | Type | |
|---|---|---|
| `mode` | choice: `generate`, `file` | |
| `slug` | string | `generate` only. A plugin slug |
| `from`, `to` | string | `generate` only. Full gateway commit shas on `main`; `from` is what is running |
| `path` | string | `file` only. A path under `registry/` in the repo, matching `^registry/[a-z0-9-]+\.sql$` (so no `..` and no other directory), read with `git show <sha>:<path>` |
| `sha` | string | `file` only. A full commit sha on `main` holding that path |
| `sha256` | string | The sha256 of the exact text that will run. Required |
| `rollback` | boolean | Run the rollback half instead |

For `generate`, the rollback is the generator's rollback output for the same `(slug, from, to)`.
For `file`, a forward file `registry/<name>.sql` has its rollback at `registry/<name>.rollback.sql`
at the same sha, and both are committed together. The `sha256` input is always of the file that
will run, so a forward and its rollback have different ones.

### `request`: no secret, no environment

1. The run is from `main`, and every named sha is a full sha on `main`.
2. Produce the text: generate it from the two commits' tool files (`generate`), or read it from
   the repo at the sha (`file`).
3. Check it (section 2). A file that fails is refused here, before anyone is asked.
4. Compute its sha256. If it is not the `sha256` input, stop. That input is how the person who
   dispatched says which file they mean, and how a reviewer on a phone can tell the run in front
   of them is that file.
5. Print the request: the mode, the slug or path, the shas, the sha256, the generator's summary
   lines (`adds drive_upload_file`, `changes gmail_read: description`, the row counts before and
   after), and the full text in a collapsed block. Pass the text and its sha256 to the next job as
   an artifact, not as an output: a file can be larger than a job output carries.

`run-name` carries what the reviewer needs on the approval screen: `registry <slug or path>
<first 12 of sha256>` and `rollback` when it is one.

### `apply`: on `environment: production`, after approval

1. Fetch the artifact. Recompute its sha256 and compare with the input again, in the job that
   holds the secret.
2. Run the check again (it is a script in the repo, so this is the same code at the same sha).
3. Send the exact bytes it hashed to the database as ONE simple query through a driver, with a
   statement timeout and a lock timeout. Not through the interactive command-line client: it
   acts on backslash commands (one of them runs a shell, with the secret in its environment)
   and splits statements by its own rules, and the file must reach the server as the text that
   was checked and nothing else. No retry. The secret is given to this one step's environment,
   not to the job. The driver is the one the gateway already depends on, installed from the
   repo's lockfile with its integrity hashes, before the secret is given to any step; nothing
   else is installed.
4. Print the rows the final read returns: name, description md5, schema md5, read-only hint,
   `updated_at`. Never the connection string, never a server message that could quote it.
5. Exit with the query's outcome. A guard that raised rolls the whole transaction back, and
   the run says so.

`concurrency: registry-production`, never cancelled in progress. A registry run and a deploy are
different groups: they are ordered by a person (section 5), not by the runner.

## 2. What the workflow will run

One file, one transaction, one database. The check refuses anything that is not a registry
change, on the text, before approval and again after.

**The check is a grammar, not a search for bad words.** It accepts exactly the shape
`registry-diff` writes and nothing else, line by line:

- comment lines; then `BEGIN;`; `SET LOCAL standard_conforming_strings = on;`; `DO
  $registry_change$`; the block; `$registry_change$;`; one read of `tools` joined to
  `mcp_servers`; `COMMIT;`. Nothing after.
- Inside the block: `DECLARE n int;`, `BEGIN`, then only the three statement forms the generator
  writes (an `UPDATE tools ... FROM mcp_servers`, an `INSERT INTO tools ... SELECT ... FROM
  mcp_servers ... NOT EXISTS`, a `DELETE FROM tools ... USING mcp_servers`), each naming one
  slug and one tool name, and each followed by `GET DIAGNOSTICS n = ROW_COUNT;` and the raise
  unless one row moved. Then the count of the plugin's rows and its raise, then `END`.
- An `UPDATE` sets only `description`, `input_schema_json`, `read_only_hint` and
  `updated_at`, never `mcp_server_id`, `name` or `namespaced_name`, so a row cannot be moved to
  another server or renamed. An `INSERT`'s `namespaced_name` is exactly `<slug>__<name>` for the
  slug and name in the same statement, and every statement in a file names the same slug.
- An `UPDATE` or `DELETE` without both md5 guards is not in the grammar. Neither is any other
  table, any DDL, `SET` other than the one above, `COPY`, a function call other than `md5` and
  `now()` and `count(*)`, or a second `DO` block.
- The dollar-quote tag appears exactly twice. String literals are the generator's form
  (single-quoted, quotes doubled, `standard_conforming_strings` on), and the check reads them
  with the same rules, so text inside a description cannot be mistaken for a statement.
- No backslash outside a string literal, no `E'...'` string, no dollar-quote tag but
  `$registry_change$`. The check's reading of where a literal starts and ends has to be the
  server's, or a statement could hide inside what the check took for a string.
- At most 40 row statements in one file.

A hand-written file (mode `file`) has to be written in that shape. That is deliberate: the shape
carries the guards, and a file that does not need guards does not need this workflow.

**Why a grammar and not a SQL parser.** A parser would accept every valid statement and then
need rules for which ones are allowed; the grammar accepts one shape and refuses the rest
without having to list them. The generator's output is line-structured and stable, and the
check and the generator live in the same repo and are tested against each other: every file the
generator writes in its own tests must pass the check, and a set of near-misses (a guard
removed, a second table, a statement appended after `COMMIT`, a `$registry_change$` inside a
description) must fail.

### A restricted role as well

The check is code we wrote. The role is the database's own rule. **Recommended, and in the first
step** (section 8): a role that can `SELECT` on `mcp_servers` and `SELECT`, `INSERT`, `UPDATE`,
`DELETE` on `tools`, with `UPDATE` granted on four columns only (`description`,
`input_schema_json`, `read_only_hint`, `updated_at`) so the database itself refuses an update
that moves or renames a row. Nothing else: no other table, no `CREATE` on the schema, no role or
database rights. A statement timeout and a lock timeout set on the role. `tools.id` defaults to
a random uuid, so no sequence grant is needed.

The role is created by SQL, not in the provider's console: a role made in the console is given
membership of the provider's administrative role, which would undo all of the above. After it is
made, a check that it is a member of no other role and that a read of another table is refused.

What it buys: if the check has a hole, or a change to the workflow merged to `main` skips it,
the worst the connection can do is change registry rows. Without it, the secret is a production
credential that can read and write every table, held in GitHub.

To verify when the role is made: whether rows in other tables reference `tools` with a delete
rule, and that a guarded `DELETE` still works as this role. Referential actions run with the
table owner's rights in Postgres, so a cascade should not need grants on the referencing
tables; that is to be confirmed on a branch, not assumed.

## 3. The connection

An environment secret on `production`, holding a connection string for the role above, with TLS
required. The connection string is put in place by a person, from the role the SQL created; its
record of truth is in the parameter store with the other production secrets, as the deploy
key's is; GitHub holds a copy.

- **Never read before approval.** Only the `apply` job references it, and that job runs only
  after the environment approves. A run that is not from `main` cannot reach the environment,
  because the `production` environment's deployment rule allows `main` only; that rule, not
  this workflow, is what holds it, and it is the same rule `release.yml` relies on.
- **Rotation.** Set a new password on the role by SQL, put the new string in the parameter
  store and the environment secret, in that order. No code changes. Rotate on any
  suspicion and when a person with access leaves.
- **What is logged.** The request (section 1), the rows the final read returns, the query's
  status. Never the string, the host name or a raw server error. GitHub masks secret values in
  logs; the job does not rely on that and never prints them in the first place.

## 4. The record

- **Who and when.** The environment's deployment record names the approving account and the
  time, as for a deploy.
- **What ran.** The run's summary: the request block, the sha256, and the returned rows.
- **How HQ reads it.** `gh run view <id> --log` and the run's summary; the run id goes in the
  Deploys row with the sha256, the mode and the slug or path, the shas, the approving account
  and the drift result.

### The drift check

The drift check (A4) runs inside the gateway and is not reachable from a GitHub runner as it
stands. Two ways to put it in the run:

- **A host verb.** The host script gains one more verb, `registry-check`, which runs the same
  comparison inside the running gateway and prints `n/n` per plugin. The workflow asks it after
  the change, over the key it already has. No new credential.
- **The runner, from HQ.** As today: after the run, HQ starts case A4 and reads `n/n`.

Recommended: the second in the first step, the first later (section 8).

## 5. Order against a deploy

As today: for a new tool, the row before the image that serves it; for a removed tool, the image
before the row goes. Between the two the drift check is red by design.

So **the drift check is advisory, never a gate.** It runs after `COMMIT`, so it could not stop the
change anyway, and a gate that fails the run that did the right thing teaches people to ignore
it. The run prints the result and the expected state ("red until gateway <to> is deployed" for
an add, "red until this runs" printed by the deploy for a removal), and HQ's Deploys row
records it.

The `request` job prints the order in words for the change in front of it: a file that adds rows
says the image comes after; one that removes rows says the image must already be live, and
names the commit.

## 6. What changes for HQ, and the sentences

The double confirm stays, and only its second half moves:

- **Confirm 1 stays in chat.** HQ shows the change (the generator's summary and the file), and
  Manuel names production in words.
- **Confirm 2 becomes the environment approval.** From any device, on the run whose name carries
  the first 12 characters of the sha256 HQ showed.

Draft sentences for HQ to place in its rules (HQ edits its own file):

> A production registry change runs only through the `registry` workflow. HQ shows Manuel the
> change and its sha256; Manuel names production in words; HQ dispatches the run with that
> sha256; Manuel approves the run in GitHub, checking the sha256 in its name. Nobody runs
> registry SQL on production any other way.

> The local one-shot confirmation and its helper remain for production SQL that is not a
> registry change, such as a schema migration or a data fix, until those have a pipeline of
> their own.

Because the approval is a record and not a control (SCRUM-394, section 6), the words in confirm
1 remain the control. The run makes the change visible and recorded; it does not prove a person
approved it.

## 7. Threats

| Threat | What stands against it |
|---|---|
| Anyone who can dispatch proposes SQL | Proposing is not running. The file must pass the check, match its sha256, and be approved |
| A branch edits the workflow to skip the check or print the secret | A run that is not from `main` cannot reach the environment, so it never gets the secret |
| A change to the workflow merged to `main` | The pull request gate; and the restricted role bounds what even a changed workflow can do |
| A hole in the check | The role: the connection can change registry rows and nothing else. The guards in the file: a row that is not what the file expects is not touched |
| A compromised action or runner image | Actions pinned by commit, as in `release.yml`; only GitHub's own; the database driver installed from the lockfile with its integrity hashes, and nothing else installed. A compromised image could read the secret after approval: the role bounds it, and rotation ends it |
| The wrong file approved | The sha256 in the run name, matched against the one HQ showed in confirm 1 |
| The secret printed | It is never echoed; database errors are not printed raw; it is in one step's environment only |
| A bad row through a hole in the check | A tool's description goes into a model's context, so a changed description is also a way to put instructions in front of a model. The guards and the role keep the change to rows the file names; reading the shown text in confirm 1 is what catches a hostile description |
| An old file run again | The md5 guards make most replays touch nothing and raise. A rollback can still apply cleanly if the rows happen to match it again, so a run is dispatched only for a change HQ has just shown, by its sha256 |

Private scenarios and reproductions belong in the private repository, not here.

## 8. Effort and stages

Each stage is one change and one rollout.

1. **The workflow, `file` mode, with the role.** `registry.yml`, the check as a script with its
   tests against the generator, `registry/` for committed files. The role is created in this
   step, before any database credential is put in GitHub. Needs from Manuel: creating the role
   (its SQL is part of the step, run once through today's confirmed flow), creating the
   environment secret and its parameter-store copy. The environment's reviewer is already him.
   The drift check stays HQ's runner case.
2. **`generate` mode.** The job fetches both commits' tool files from CI's records with the
   generator's own trust rule (a build run on `main`), so registry SQL no longer has to be
   committed or transcribed.
3. **The host verb for the drift check**, printed in the run.

The brief's order put the role second. This spec puts it first, because without it step 1
stores an unrestricted production credential in GitHub for the length of step 1. If the role is
deferred, the secret should be the gateway's own role only for as long as that takes, and the
spec does not recommend that.

## 9. Proven and not proven

Proven: nothing; this is a spec.

To be proven by test: every file the generator writes passes the check; each near-miss fails;
the sha256 mismatch stops the run in `request`; a run not from `main` gets no secret.

To be verified when built: that the driver sends the file as one simple query, never as a
prepared statement or split into several; the role's grants against a guarded insert, update and delete on a database branch,
including any referencing rows; that the mobile approval screen shows the run name in full.

## Decisions

1. Mode C (`generate`) as the normal path with A (`file`) for the rest, and B not offered.
2. The restricted role in the first step rather than the second.
3. The drift check advisory, HQ's runner case first and a host verb later.
4. Files for mode A committed under `registry/` in this public repository. They hold tool
   descriptions and schemas, which the plugins already publish, and md5 guards.
