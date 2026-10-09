# SCRUM-394: CI gates, and deploys that GitHub builds and a person approves

Status: BUILT, revision 5 (2026-10-09): every step of section 8 has been done. The
pull-request gate and the repository settings of section 3, the image build of section 4
(`build.yml`), the canary deployed, rolled back and deployed again through `release.yml`
and the host script (steps 4 to 6), and the gateway's first pipeline deploy (step 7; "The
gateway's first pipeline deploy" below says how it differs from what step 7 first proposed,
and what it measured). What the spec proposed and was not built is said where it comes up.

Two things are specified. First, a workflow that runs the gate on every pull request, with
`main` protected. Second, a pipeline in which GitHub builds an image for a commit, a named
person approves, and the host runs that image for one surface. Nothing is built on the host,
and a rollback is the previous image.

**How to read the claims.** *Read* means taken from this repo or from what GitHub shows anyone
about a public repository. *Proposed* means design that nothing has exercised: every workflow,
every GitHub setting and every host step here is in that class until its step reports.

## 1. What this spec refuses

1. **No self-hosted runner on the production host.** The repo is public and forkable. A
   runner on the box turns "can get a workflow to run" into "has a shell on production".
2. **No secret is ever available to code from a fork.** The workflow uses the `pull_request`
   event. `pull_request_target` is not used anywhere.
3. **The approval is not called a control.** Ruled: agent sessions and the approver keep one
   GitHub identity for now. The environment approval is a record and a convenience, and the
   standing rule (a person says go, in words, before a production change) stays the control.
   Narrowing the agents' credential is parked, not refused. Section 6.
4. **Nothing is built on the host, and the host holds no credential that can write to the
   registry or to GitHub.**
5. **Whatever reaches the host cannot open a shell.** It can ask for one surface at one
   commit, and the host validates the request itself.
6. **A merge does not deploy.** A merge builds an image. A deploy is dispatched for a named
   surface and sha, then approved.
7. **No mutable tag is ever deployed.** Images are tagged by commit sha and run by digest.
8. **The pipeline does not touch the database.** Migrations and registry writes stay with a
   person, as today.
9. **The security reviewer is not in the workflow.** It is an agent. In CI terms it stays
   advisory: it runs only when someone runs it, before a push.
10. **The leak scan never prints what it matched.** Its pattern list is a secret and the
    repo's logs are public, so a finding names the rule and the place, never the text.
11. **A second copy of the gateway is never started to prove the pipeline.** Two gateways
    would both run the scheduled jobs, and the test runner assumes one process. The proof uses
    a surface that does nothing (section 8).
12. **`deploy-gateway.sh` is not deleted** until the pipeline has done a real gateway deploy.
    It stays as the documented fallback after that.

## 2. Today

| Fact | Source |
|---|---|
| No workflow exists | No `.github/` directory |
| `main` is unprotected; forking is allowed and forks exist | The public repository API |
| No environment is defined | The public repository API |
| Agent sessions and the person who approves a production change do not have separate GitHub identities | Section 6 |
| The gateway image is built on the host by `docker compose up --build`, from a checkout the script first verifies | `scripts/deploy-gateway.sh` |
| Rollback is a local image tag named after the running sha; the newest five are kept by the script | Same |
| The host's disk filled once with rollback images, and build cache grows by gigabytes a build | The script's header |
| The gateway does not report its own commit on `/health` | `apps/gateway/src/gateway/health.ts` |
| Every gate runs only when a person or an agent types it | `CLAUDE.md`; no CI |

## 3. Part 1: the gate runs on every pull request

**The workflow** (`.github/workflows/ci.yml`).

| Property | Value | Why |
|---|---|---|
| Trigger | `pull_request`, and `push` to `main` | A fork's pull request runs with no secrets and a read-only token under this event |
| Permissions | `contents: read`, nothing else | The jobs only read and test |
| Job `gate` | Frozen install, then `scripts/gate.sh <base>`. **No secret** | One script, the same one a person runs before a push |
| Job `leak-scan` | `scripts/leak-scan.py` over the pull request's range, diff and commit messages. **One secret: the pattern list** | Ruled: a required check. The scanner is public; its list is not |
| Actions used | GitHub's own only, pinned by commit sha | A tag can be moved; a sha cannot |
| Concurrency | One run per pull request, the older one cancelled | |

**`scripts/gate.sh`.** Ancestry check against the base; a path table that maps changed files to
surfaces; then typecheck and tests for the surfaces that changed, and nothing for a docs-only
change. A path it does not recognise selects everything. It starts with the gateway's rows;
plugin rows arrive with the plugins (SCRUM-390).

**`leak-scan`, and what its public logs may show.** A finding prints the rule's id, the file
and the line number. It never prints the matched text, the line, or the rule's pattern. A
self-test runs first and proves every rule still matches its own sample, also without printing
either. On a fork's pull request the secret is absent, and the job **fails** with a sentence
saying a maintainer must run the scan: an unscanned change must not read as a clean one.

Two limits, stated so the check is not read as more than it is. The scan in CI runs after the
branch is already pushed to a public repository, so it can stop a merge but not a publication;
the scan before a push is still the one that prevents a leak. And CI carries the shared rule
list only; a rule kept on one machine is not in it.

**What a green check means, and what it does not.**

| Runs in the workflow | Does not run there |
|---|---|
| Ancestry check; typecheck and tests for the changed surfaces | The security reviewer |
| The leak scan, shared rule list, over the diff and the commit messages | The production build. It runs when the image is built on `main` (section 4), so a change that only breaks the build is caught after merge. Adding it to the pull-request gate costs minutes per run and is open (section 11) |
| | Every suite gated on a live registry or a running plugin. These report skipped, and skipped is not passed |

**Repository settings** (proposed; changed by an admin, shown and agreed before they change,
recorded in that step's report and not here).

| Setting | Value |
|---|---|
| Branch protection on `main` | Pull request required; `gate` and `leak-scan` required and up to date; no force push; no deletion; applies to administrators too |
| Merge styles | Merge commits only. Squash and rebase off. Linear history is **not** required: the plugin import in SCRUM-390 needs merge commits |
| Required approvals on a pull request | None. A second rule here would be approved by the same hands |
| Fork pull requests | Workflows from outside collaborators need approval before they run |
| Allowed actions | GitHub-owned only; sha pinning required |

## 4. Part 2: GitHub builds, a person approves, the host runs it

### The image

| Property | Value |
|---|---|
| Registry | GitHub's container registry, under this repository. **Public** (ruled): the image holds what this public repo holds plus public build values, and the host then needs no registry credential |
| Name and tag | One package per surface. Tag is the full commit sha. No `latest` |
| Built when | On a push to `main` that touches the surface's paths (the path table `gate.sh` uses), or by dispatch for any commit that is an ancestor of `main` |
| Built from | `apps/gateway/Dockerfile`, unchanged. `GATEWAY_SHA` is the commit. The `NEXT_PUBLIC_*` build arguments come from repository variables, not secrets: they are compiled into the browser bundle and are public by nature |
| Labels | The OCI revision label carries the commit sha |
| Job permissions | `contents: read`, `packages: write`. No environment, no deploy secret |

### The deploy

`release.yml`, job `deploy`, started by `workflow_dispatch` with three inputs: `surface`,
`sha`, and a `rollback` flag.

| Step | What | Stops if |
|---|---|---|
| 1 | The job declares `environment: production`. GitHub holds it until a reviewer approves | Not approved |
| 2 | Resolve the image for `surface` and `sha` to its digest, from the record the build run on `main` kept of what it pushed. The registry tag is only cross-checked against it, never trusted | No such record, or the tag no longer holds that digest |
| 3 | Hand the host the request, one line over SSH: surface, sha, digest (section 5) | The host refuses the request |
| 4 | On the host: lock, check the commit is on `main` and newer than the one running, pull by digest, check the image's revision label, point the compose file's image variable at it, `compose up -d --no-build <surface>`. For the gateway this was to re-render `.env` from the parameter store first; as built, a person still does that (section 8, "The gateway's first pipeline deploy") | Pull fails: nothing changed |
| 5 | On the host: the container is running the requested digest and the surface reports the requested commit | Either fails: the host starts the image that was running again |
| 6 | The job reports surface, sha, digest, previous sha and the time taken | |

The environment is limited to the `main` branch. Step 2 runs in a job of its own, before the
approval and without any secret, so the reviewer sees the exact request line they approve.

**Where the digest comes from.** Anyone who can push a branch can publish an image under any
tag, so a tag is not evidence. A build run that pushes an image keeps the digest as an
artifact of that run, and a run that finds the tag already present keeps nothing. The deploy
accepts the artifact only from a run of `build.yml`, started by a push or a dispatch, at a
commit that is on `main` (`scripts/published-digest.sh`). The limit: artifacts last 90 days,
so an image older than that cannot be deployed by the pipeline and the surface needs a newer
build. The two images published before this record existed have none.

**Compose.** The gateway service's `build:` block becomes `image: ${GATEWAY_IMAGE}`. The dev
compose file keeps building locally.

**The host script** (`scripts/host-deploy.sh` in this repo; built for the canary, not yet
installed anywhere). It is installed on the host by a person, at a fixed path outside any
checkout, and is **not** updated by the pipeline: a deploy that could replace the thing that
validates deploys would make the validation decorative. It accepts a surface from a fixed
list, a 40-character sha and a sha256 digest, pulls only from this repository's registry
namespace, and keeps the newest five images per surface so a rollback works with the registry
unreachable. The host has no checkout to consult, so it asks GitHub's public API whether the
commit is on `main` and newer than the one running; no answer is a refusal. It cannot tell
who published an image: that is step 2's job, and the script's header says so.

**Rollback** is the same dispatch with the `rollback` flag and the sha being returned to. The
host restores the image it recorded as *previous* and refuses if that is not the sha named.
Nothing builds and nothing is pulled. It needs the same approval, because it is a deploy. When
GitHub itself is unavailable, an operator with their own access runs the host script with
`--previous`; that path is the fallback, not the routine.

**The record.** A job that uses an environment creates a GitHub deployment: surface, sha, who
approved, when, and the outcome.

## 5. Part 3: how GitHub reaches the host

| | A. Self-hosted runner on the host | B. Deploy user and a restricted SSH key |
|---|---|---|
| Direction | The host polls out. No inbound port | GitHub connects in. SSH must accept GitHub's runner addresses, which is in practice the internet, with key-only auth |
| Stored credential | None in GitHub. A runner registration on the host | A private key in an environment secret |
| What a hostile or mistaken workflow gets | Code execution on the production host as the runner's user. With Docker access that is root | One command with validated arguments. Never a shell |
| Public repository | GitHub's own guidance is not to attach self-hosted runners to public repositories. Whether this organization's plan can restrict a runner to named workflows was not verified | No exposure from pull requests: the key lives in the environment |
| Footprint on the host | A daemon that updates itself, holds memory and shares the disk with production | One user, one line in `authorized_keys`, one script |

A is refused (refusal 1). B was the first recommendation. The review asked for a third shape to
be compared before anything is built, one where the host asks instead of being told. That
comparison is **Addendum A**. **Ruled: B**, for the reason recorded at the end of the addendum.

B is narrowed like this: a dedicated user that owns nothing; an
`authorized_keys` entry with a forced command and the `restrict` option; Docker reached only
through the host script by a sudo rule naming it; the host's key pinned by the caller; the host
address, private key and pinned host key as secrets of the `production` environment (never of
the repository, so a run that is not from `main` gets none of them), never in this repository; and
the credential's record of truth in the parameter store with the other production secrets,
with GitHub holding a copy.

## 6. The approval is a record, not a control

An environment's required-reviewer rule asks one question: did an allowed **account** approve.
It cannot tell a person from a session acting as that person's account. So the rule is a
control only if no automated session can act as a reviewer, or change the rule, the branch
protection or the workflow files.

That separation does not exist today, and the ruling is to leave it that way for now.
"Prevent self-review" therefore stays **off**: turned on, it would stop the one reviewer from
approving anything a session had dispatched under the same account.

What follows from the ruling, so nothing here is over-read:

| Statement | True today |
|---|---|
| A deploy cannot start without someone approving in GitHub | Yes |
| Every deploy leaves a record of surface, sha, time and outcome | Yes |
| A deploy cannot start unless a human approved it | **No.** The control for that is the standing rule that a person says go, in words |
| A stored deploy credential is out of an automated session's reach | **No.** This weighs on Addendum A |

Parked, not refused: a separate identity for automated sessions, with write access and no
reviewer or admin rights. On the day that exists, self-review prevention goes on and the first
table row becomes the third.

## 7. Part 4: what the existing pieces become

| Today | Becomes |
|---|---|
| `scripts/deploy-gateway.sh` builds on the host | The fallback for a GitHub outage, unchanged, until the pipeline has a real gateway deploy behind it. Then its build step is removed and it becomes a thin wrapper around the host script |
| Rollback tags named after the running sha, pruned to five by the script | The registry keeps every sha's image. The host script keeps five locally. The "tag the running image before building" rule disappears with the build |
| `.deployed-sha` on the host | The host script's state file: current and previous image per surface. Same rule: written only after health passes |
| Host build cache, and the chore that prunes it | Nothing to prune once the gateway is no longer built on the host. The chore is worth having until then |
| A failed build leaves the old container serving with health ok | A failed build fails in GitHub before anything reaches the host |
| The `deploy` skill | Rewritten around: dispatch, approve, read the job output. The manual steps move to a fallback section. Same PR as the pipeline (freshness rule) |
| The rollout runbook kept outside this repo | Loses its build and tagging steps; keeps the baseline and post test runs, the drift check and the smoke, which the pipeline does not do |
| The deploy record | Written from the GitHub deployment: surface, sha, digest, approver, time, previous digest |
| `GATEWAY_SHA` | Still a build argument, now set by the workflow from the commit it checked out |
| Plugin rollouts | Unchanged by this spec. They join the pipeline as surfaces when they become images (SCRUM-390) |

## 8. Part 5: the smallest step that proves the pipeline

The pipeline is proven first on a surface with no traffic: a **canary**, a container that
answers `/health` with its own commit on the internal network, publishes no port and does
nothing else. It stays afterwards as the place to rehearse a host-script change or a
credential rotation without restarting anything a user touches.

| # | Step | Measured or verified | Rollback |
|---|---|---|---|
| 1 | `ci.yml`, `gate.sh`, `leak-scan.py` merged | Each check is seen **red** on a deliberately failing commit before it is trusted green. Wall time of each job | Revert |
| 2 | Settings: protection on `main`, merge styles, fork approval, allowed actions. Shown and agreed first | A scratch pull request that fails a check cannot merge; one that passes can; a squash is not offered | Revert the settings |
| 3 | Build workflow merged. It builds the canary image and the gateway image for the sha that is running | Build time; image size; each image's revision label equals the sha | Delete the package versions |
| 4 | Host prepared by a person, one step at a time, each agreed first: the host script, compose reading image variables, the canary service, and the request path Addendum A's ruling picks | A malformed sha is refused; a surface outside the list is refused; nothing can obtain a shell | Remove what was added; restore the compose file |
| 5 | **First approved deploy: the canary** | Time from approval to healthy. The running container's image is the requested digest. The gateway's start time is unchanged | The host script's `--previous` |
| 6 | **Rollback of the canary through the pipeline**, then forward again | Time for each. Nothing built, nothing pulled on the way back. The gateway's start time is unchanged | The fallback script |
| 7 | **The gateway's first pipeline deploy, its own go:** the GitHub-built image of a commit on `main` that differs from the one running by as little as possible | One restart. A test run before and after diffs to zero. The intended difference is who built the image | The scripted path, back to the host-built image |

Steps 5 and 6 cost no user anything. Step 7 is one gateway restart, in a window named in
advance. What stays unproven after step 7, and is accepted: a rollback of the gateway itself
through the pipeline. The mechanism is the same one the canary exercised; the first real
gateway rollback will be its first use on that surface.

### The gateway's first pipeline deploy

What was built for step 7, and where it departs from the row as first written:

- **Not the sha already running.** A deploy takes its digest from the record a build on
  `main` kept (section 4). The commit that was running when the pipeline arrived was built
  before records existed, so it has none and cannot be deployed this way. The first gateway
  deploy is therefore a newer commit on `main`, chosen so that the gateway's own code differs
  as little as possible from what is running. No path accepts an image without a record.
- **One compose file, two ways to start it.** `docker/docker-compose.prod.yml` now names its
  image with a variable. The host script sets it to a digest and starts with `--no-build`;
  the scripted path leaves it unset and builds, as before. Both use the same compose project,
  so the container, the plugin volume and the network are the same ones either way. A person
  installs a copy of the file on the host, and the deploy workflow stops a deploy when that
  copy's checksum is not the file on `main`: a value added to the file reaches production
  only when the copy is replaced, and a deploy that skipped that would start the gateway
  without it and without saying so.
- **The env file stays where it is** for now: the host script points compose at the file the
  scripted path already keeps, and only checks it is there. Rendering it from the parameter
  store is still a person's step. Moving it out of the checkout is a later change.
- **What is running is asked of the host, not of the record.** The scripted path stays as
  the fallback, so the record of what the pipeline last deployed can be older than what is
  running. Whenever the running container is not on the recorded image (always, before the
  first pipeline deploy), the host script reads that container's image and the commit it
  reports. The new commit must be newer than that one, and if the new image does not come
  up, that image is started again by its id. A container that cannot say which commit it is
  gets a refusal, not a guess, and so does any request when the host cannot be asked what
  is running. The script never takes the gateway's project down and never starts a gateway
  where there is no container: it only replaces one.
- **A rollback is one step back, or it is refused.** It returns only to the image the last
  pipeline deploy itself replaced, and only while the gateway is still on the image that
  deploy started. A deploy over an image something else started records no previous at all:
  not that image, which the pipeline cannot name by digest, and not the older one its record
  still held, which may be many commits behind. So after the first pipeline deploy, and
  after any pipeline deploy that follows a use of the scripted path, `rollback` is refused
  until the next deploy.
  The way back from the first one is the scripted path, which still works: started from the
  checkout without a build, the same compose file runs the last host-built image again.
- **How the gateway says which commit it is.** Its `/health` does not name one. The host
  script waits for `/health` to answer ok and reads the commit the image was built with,
  inside the container.
- **Not here:** a slimmer, multi-stage gateway image. That is its own change, after the
  first pipeline deploy, so that deploy changes one thing.

What step 7 measured, on 2026-10-09:

| Measured | Result |
|---|---|
| Restarts | One. The image was pulled while the old container kept serving (65 s for a 4 GB image), then the container was replaced |
| Outage seen from outside | About 5 seconds, probed twice a second |
| Outside checks before and after (17: health, pages, OAuth metadata, `/mcp` refusals, redirects) | Identical, line for line |
| Tool calls through a real client, before and after | Answered; the client reconnected by itself |
| Plugin volume, plugin files, plugin processes | The same volume and mount, the same file count, both plugins running |
| Environment in the container | The same key names and the same values, compared by hash |
| Put-back | Not needed, so not exercised on the gateway |

Still unproven on the gateway, and accepted: a rollback through the pipeline (none exists
until the second deploy) and a put-back after a failed start. Both were exercised on the
canary and on a scratch project with real Docker.

Left as it was, on purpose: the host still has its checkout and can still build. A deploy no
longer needs either. The env file lives in the checkout and the scripted fallback uses it,
so moving that file and removing the checkout is a later decision, not part of this one.

## 9. Order, and how this meets SCRUM-390

1. Section 8 step 1: the pull-request gate, as its own PR.
2. Step 2: the settings, shown and agreed.
3. Step 3: the build workflow. No deploy.
4. Addendum A ruled, then steps 4 to 7, each host step agreed one at a time.
5. SCRUM-390's import, which needs the merge-style setting already in place.
6. SCRUM-390's plugin images, which reuse this pipeline with two more surfaces.

## 10. Risks

| Risk | What holds it down |
|---|---|
| The approval is treated as a control | Refusal 3; the table in section 6 |
| A finding in CI prints the sensitive text into a public log | Refusal 10, pinned by the scanner's own test: a finding's output is checked for the matched text |
| A pull request from this repo edits the workflow to print the secret | Not held down by design: anyone who can push a branch here is trusted with it. The list is rotated if it is ever exposed |
| A stolen deploy credential redeploys an old, weaker image | Without the `rollback` flag the host refuses any sha that is not on `main` and newer than the current one, asked of GitHub's public API from the host; with it, only the recorded previous image |
| A tag in the registry is overwritten by someone with push access | The deploy never reads its digest from a tag; it reads the build run's own record and stops if the tag disagrees with it |
| An image built by GitHub behaves unlike the one built on the host | Step 7 deploys the same sha and diffs a test run before anything new ships |
| The host script drifts from the copy in the repo | The script reports its own checksum with every deploy |
| A dependency of a workflow is compromised | GitHub-owned actions only, pinned by sha; the build job has no deploy secret; the deploy job runs no third-party code |
| Registry or GitHub outage during an incident | Five images per surface on the host; the fallback path needs neither |
| A green check is read as "the security gate passed" | The table in section 3 |

## 11. Rulings, and what is still open

Ruled: no separate identity for automated sessions for now, self-review prevention off
(section 6); images public; the leak scan a required check with its list as a secret; one
approver; the first deploy on a surface with no traffic; the gateway's window named when the
pipeline is ready for it; Addendum A, the restricted SSH key.

Open:

1. **The production build in the pull-request gate**, once its run time is measured.

## Addendum A: the host asks, or the host is told

Section 5 compared two ways for GitHub to push a deploy at the host. Both share one
assumption: something outside the host holds the means to reach in. The shape that drops it:

**C. The host pulls.** The approved job publishes a deploy request and waits. A small timer on
the host reads the repository's pending requests, validates one exactly as the host script
validates arguments today, and runs it. The job learns the outcome by reading what the host
serves, not by being connected to it.

| | B. Restricted SSH key | C. The host pulls |
|---|---|---|
| Stored credential | A private key, in GitHub and in the parameter store | **None, anywhere** |
| Inbound access | SSH open to GitHub's addresses, in practice the internet | None beyond what serves the site today |
| What an automated session can reach today (section 6) | It can cause an approved job to run, so it can use the key. It could also change a workflow to copy the key out, after which the key works from anywhere until rotated | It can cause an approved request to be published. Nothing exists to copy out |
| What a request can do | Deploy an image this repository published, at a sha the host accepts | The same. The validation is identical |
| New on the host | A user, a key line, a sudo rule | A timer and a reader of one public endpoint |
| Latency | Seconds | Up to the timer's interval; a minute is a sensible first value |
| How the job knows the result | The command's exit code, directly | It watches a public status: the host has to publish the running image per surface somewhere readable |
| When GitHub is down | The fallback script | The same fallback script |
| Unknowns | None new | Whether the request record is readable without a token at the rate a timer needs; how the host tells an approved request from a merely created one |

**Recommendation: C.** Under the ruling in section 6 the two give an automated session the
same power, to deploy a published image, but only B leaves something that can be taken and
used elsewhere, and only B needs a port open to the internet. C's costs are a minute of
latency and a status the job can read, and the second of those is useful in its own right.

The two unknowns are answered by a read-only spike before section 8 step 4, with no host
contact: publish a request from a scratch workflow, read it back without a token, and confirm
an unapproved one is distinguishable. If either fails, B stands as specified.

**The spike, and the ruling.** The spike ran with no host contact. A request record can be read
without a token, but only at the unauthenticated limit of 60 reads an hour for one address,
and a read that returns "not modified" still counts: a one-minute timer uses the whole limit
and leaves nothing for a retry. An approved request can be told from a waiting one, but not
from the list of deployments, which anyone with push access can write to through the API; the
host would have to read the run and its approvals instead, which costs more reads. So C works,
with a slower timer and a more careful reader than the table above assumed.

**Ruled: B.** The risk the ruling weighs is an outsider on a public repository, and B gives an
outsider nothing: the key is a secret of an environment that only a run from `main` can reach,
and what the key can do is one validated request. The row "what an automated session can reach
today" stays true for B and is accepted, as section 6 already accepts it for the approval. The
requirements that came with the ruling are in section 5 and in "Where the digest comes from".
