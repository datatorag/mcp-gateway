# SCRUM-394: CI gates, and deploys that GitHub builds and a person approves

Status: SPEC. No workflow, setting, script or host change has been made. Written against `main`
at `c82f58c` on 2026-10-07.

Two things are specified. First, a workflow that runs the gate on every pull request, with
`main` protected. Second, a pipeline in which GitHub builds an image for a commit, a named
person approves, and the host pulls that image and restarts one surface. Nothing is built on
the host, and a rollback is the previous image.

**How to read the claims.** *Read* means taken from this repo or from what GitHub shows anyone
about a public repository, on 2026-10-07. *Proposed* means design that nothing has exercised: every workflow, every GitHub
setting and every host step here is in that class. Section 8 is the step that turns the
pipeline from proposed to measured.

## 1. What this spec refuses

1. **No self-hosted runner on the production host.** The repo is public and forkable.
   Section 5 has the comparison; the short form is that a runner on the box turns "can get a
   workflow to run" into "has a shell on production".
2. **No secret is ever available to code from a fork.** The pull-request workflow uses the
   `pull_request` event, needs no secret, and has a read-only token. `pull_request_target` is
   not used anywhere.
3. **The approval is not called a gate until the approver's identity is separate from the
   agents'.** Today it is not (section 6). Shipping the environment rule without fixing that
   would be a prompt that the thing being gated can click.
4. **Nothing is built on the host, and the host holds no credential that can write to the
   registry or to GitHub.**
5. **The deploy key cannot open a shell.** It can run one command with validated arguments.
6. **A merge does not deploy.** A merge builds an image. A deploy is dispatched for a named
   surface and sha, then approved.
7. **No mutable tag is ever deployed.** Images are tagged by commit sha and pulled by digest.
8. **The pipeline does not touch the database.** Migrations and registry writes stay with a
   person, as today.
9. **The security reviewer and the leak scan are not in the first workflow.** One is an agent
   and the other needs a private pattern list. Until they are wired they are advisory in CI
   terms: they run only when someone runs them. Section 3 says how the leak scan could be
   wired without publishing its list.
10. **`deploy-gateway.sh` is not deleted** until the pipeline has done a real deploy and a
    real rollback. It stays as the documented fallback after that, section 7.

## 2. Today

| Fact | Source |
|---|---|
| No workflow exists | No `.github/` directory |
| `main` is unprotected; forking is allowed and forks exist | The public repository API |
| No environment is defined | The public repository API |
| Agent sessions and the person who approves a production change do not have separate GitHub identities | Section 6 |
| The gateway image is built on the host by `docker compose up --build`, from a checkout the script first verifies | `scripts/deploy-gateway.sh` |
| Rollback is a local image tag named after the running sha; the newest five are kept by the script | Same |
| The host's disk filled once with rollback images, and build cache grows by gigabytes a build | The script's header; the pending build-cache chore |
| The gateway does not report its own commit on `/health` | `apps/gateway/src/gateway/health.ts` |
| Every gate runs only when a person or an agent types it | `CLAUDE.md`; no CI |

## 3. Part 1: the gate runs on every pull request

**The workflow** (`.github/workflows/ci.yml`, proposed).

| Property | Value | Why |
|---|---|---|
| Trigger | `pull_request`, and `push` to `main` | A fork's pull request runs with no secrets and a read-only token under this event |
| Permissions | `contents: read`, nothing else | The job only reads and tests |
| Job | `gate`: install with a frozen lockfile, run `scripts/gate.sh origin/main` | One script, the same one a person runs before a push |
| Actions used | Only GitHub's own, pinned by commit sha | A tag can be moved; a sha cannot |
| Concurrency | One run per pull request, the older one cancelled | |

`scripts/gate.sh` does not exist yet. It is specified in the SCRUM-390 spec (ancestry check,
path-to-surface table, the selected builds, typechecks and tests through turbo's changed-package
filter). It lands in the same PR as this workflow, with the gateway rows only; plugin rows are
added when the plugins arrive.

**What a green check means, and what it does not.**

| Runs in the workflow | Does not run there |
|---|---|
| Ancestry check; the builds, typechecks and tests the changed paths select | The security reviewer agent |
| The hook scripts' own tests | The leak scan: its pattern list is private by design |
| | Every suite gated on a database or a running plugin. These report skipped, and skipped is not passed. The workflow prints the list of skipped suites so the count is visible |

**Repository settings** (proposed; changed by an admin in the GitHub UI, recorded in the report
of the step, not in a file here).

| Setting | Value |
|---|---|
| Branch protection on `main` | Pull request required; the `gate` check required and up to date; no force push; no deletion; applies to administrators too |
| Merge styles | Merge commits only. Squash and rebase off. Linear history is **not** required: the plugin import in SCRUM-390 needs merge commits |
| Required approvals on a pull request | None. The reviewer is the environment in part 2; a second rule here would be approved by the same hands |
| Fork pull requests | Workflows from outside collaborators need approval before they run |
| Allowed actions | GitHub-owned only; sha pinning required. The current values are an authenticated setting and are recorded in the step's report |

**Wiring the leak scan later** (proposed; decision 3). The scanner's code can be public; its
pattern list cannot. The list becomes an Actions secret, the scan runs on same-repo pull
requests and on `main`, and on a fork's pull request it reports skipped by name, so a
maintainer knows to run it by hand before merging. That closes the "runs only when typed" gap
for every branch an agent pushes, which is nearly all of them.

## 4. Part 2: GitHub builds, a person approves, the host pulls

### The image

| Property | Value |
|---|---|
| Registry | GitHub's container registry, under this repository |
| Name and tag | One package per surface (`gateway` now; one per plugin later). Tag is the full commit sha. No `latest` |
| Built when | On a push to `main` that touches the surface's paths (the same path table `gate.sh` uses), or by dispatch for any commit that is an ancestor of `main` |
| Built from | `apps/gateway/Dockerfile`, unchanged. `GATEWAY_SHA` is the commit. The `NEXT_PUBLIC_*` build arguments come from repository variables, not secrets: they are compiled into the browser bundle and are public by nature |
| Labels | The OCI revision label carries the commit sha |
| Job permissions | `contents: read`, `packages: write`. No environment, no deploy secret |
| Visibility | Public, recommended (decision 2). The image contains what this public repo contains plus public build values, and a public image means the host needs no registry credential at all. `.dockerignore` already keeps `.env` out of the build context |

### The deploy

`release.yml`, job `deploy`, started by `workflow_dispatch` with three inputs: `surface`,
`sha`, and a `rollback` flag.

| Step | What | Stops if |
|---|---|---|
| 1 | The job declares `environment: production`. GitHub holds it until a required reviewer approves. Environment secrets are released only after that | Not approved |
| 2 | Resolve the image for `surface` and `sha` to its digest | No image for that sha |
| 3 | Connect to the host (section 5) and run the one permitted command: deploy `surface` at `sha`, digest given | The host refuses the arguments |
| 4 | On the host: lock, record the current image as *previous*, re-render `.env` from the parameter store, pull by digest, point the compose file's image variable at it, `compose up -d --no-build <surface>` | Pull fails: nothing changed |
| 5 | On the host: the container was recreated and is running the requested digest; health answers | Either fails: the host puts *previous* back and reports failure |
| 6 | The job prints surface, sha, digest, previous digest, and the times of each step | |

The environment is limited to the `main` branch, so a workflow file on any other branch
cannot reach its secrets.

**Compose.** The gateway service's `build:` block becomes `image: ${GATEWAY_IMAGE}`. The dev
compose file keeps building locally. This touches `docker-compose.prod.yml`, which the pending
compose chore also edits; whichever lands second rebases.

**The host script** (`scripts/host-deploy.sh` in this repo, proposed). It is installed on the
host by a person and is **not** updated by the pipeline: a deploy that could replace the
command its own key is restricted to would make the restriction decorative. It accepts a
surface from a fixed list, a 40-character sha and a sha256 digest, pulls only from this
repository's registry namespace, and keeps the newest five images per surface so a rollback
works with the registry unreachable.

**Rollback** is the same dispatch with the `rollback` flag and the sha being returned to. The
host restores the image it recorded as *previous* and refuses if that is not the sha named, so
a rollback can never land somewhere unexpected. Nothing builds and nothing is pulled: the
previous image is already on the host, which also means the very first rollback, to the last
host-built image, works the same way. It needs the same approval, because it is a deploy. When
GitHub itself is unavailable, an operator with their own access runs the host script with
`--previous`; that path is the fallback, not the routine.

**The record.** A job that uses an environment creates a GitHub deployment: surface, sha, who
approved, when, and the outcome. That is a deploy record nobody has to remember to write.

## 5. Part 3: how GitHub reaches the host

| | A. Self-hosted runner on the host | B. Deploy user and a restricted SSH key (recommended) |
|---|---|---|
| Direction | The host polls out. No inbound port | GitHub connects in. SSH must accept GitHub's runner addresses, which is in practice the internet, with key-only auth |
| Stored credential | None in GitHub. A runner registration on the host | A private key in an environment secret, released only to an approved job on `main` |
| What a hostile or mistaken workflow gets | Code execution on the production host as the runner's user, for as long as it runs. With Docker access that is root | One command with validated arguments. Never a shell |
| Public repository | GitHub's own guidance is not to attach self-hosted runners to public repositories. Whether this organization's plan can restrict a runner to named workflows was not verified | No exposure from pull requests: the key lives in the environment |
| Footprint on the host | A daemon that updates itself, holds memory and shares the disk with production | One user, one line in `authorized_keys`, one script |
| If the credential leaks | A registration token: a new machine could join as a runner | The key: someone could redeploy an image this repository already published, including an old one. They cannot run anything else and cannot publish an image |

**B is recommended.** The single advantage of A, no inbound port and no stored key, is real.
It does not outweigh putting a general-purpose executor for a public repository on the one
machine that holds every user's tokens.

How B is narrowed (proposed):

- A dedicated user that owns nothing. Its `authorized_keys` entry carries a forced command
  and the `restrict` option, so the key cannot get a terminal, forward a port or run anything
  but the host script. The script reads the requested arguments from the SSH environment and
  validates them itself.
- The user reaches Docker only through that script, by a sudo rule naming the script.
  Membership of the Docker group would be root by another name.
- The workflow pins the host's key. It does not accept whatever key answers.
- The host address, the private key and the pinned host key are environment secrets. None of
  them is in this repository.
- The record of the credential is in the parameter store with the other production secrets:
  that is where it is created, rotated and read from when the GitHub secret is set. GitHub
  holds a copy. Rotation is new key, parameter store, GitHub secret, `authorized_keys`, old
  line removed, then one deploy to prove it.

A third shape was considered and set aside: GitHub's OIDC token exchanged for a cloud role
that may send one command to the instance through the cloud's own agent. It has no stored key
and no inbound port. It needs the instance enrolled with that agent and a role and document to
maintain, which is more moving parts than this stage warrants. It is the natural successor to
B if the inbound port ever becomes the thing to remove.

## 6. The approver must be an identity the agents do not hold

An environment's required-reviewer rule asks one question: did an allowed **account** approve.
It cannot tell a person from a session acting as that person's account. So the rule is a
control only if no automated session can act as a reviewer, and the same goes for whoever may
change the rule itself, the branch protection, or the workflow files. "Prevent self-review"
does not substitute for that separation: it stops the account that asked from approving, which
helps only when asker and approver were different accounts to begin with.

That separation does not exist today. The specifics are in the private report, not here.

What makes the approval real (proposed; decision 1):

| Piece | Effect |
|---|---|
| A machine account for agent sessions, with write access, not admin, not a reviewer | A session can push branches, open pull requests and dispatch a deploy. It cannot approve one, change protection or bypass the required check |
| The human accounts are the only environment reviewers; self-review prevented | The account that asked cannot be the account that approves |
| Branch protection applies to administrators | The rule holds for everyone, including on a bad day |
| Changes under `.github/` need the same pull request and check as anything else | A workflow cannot be rewritten on the way to `main` without the gate seeing it |

Until the machine account exists, the environment approval is a convenience and a record. It
is worth having on those terms. It must not be described as the control, and the standing rule
(a person says go, in words, before a production change) stays the control.

## 7. Part 4: what the existing pieces become

| Today | Becomes |
|---|---|
| `scripts/deploy-gateway.sh` builds on the host | The fallback for a GitHub outage, unchanged, until the pipeline has a deploy and a rollback behind it. Then its build step is removed and it becomes a thin wrapper around the host script |
| Rollback tags named after the running sha, pruned to five by the script | The registry keeps every sha's image. The host script keeps five locally. The "tag the running image before building" rule disappears with the build |
| `.deployed-sha` on the host | The host script's state file: current and previous image per surface. Same rule: written only after health passes |
| Host build cache, and the chore that prunes it | No gateway build on the host, so nothing to prune for this surface. The chore stays harmless until then |
| A failed build leaves the old container serving with health ok | A failed build fails in GitHub before anything reaches the host |
| The `deploy` skill | Rewritten around: dispatch, approve, read the job output. The manual steps move to a fallback section. Same PR as the pipeline (freshness rule) |
| The rollout runbook kept outside this repo | Loses its build and tagging steps; keeps the baseline and post test runs, the drift check and the smoke, which the pipeline does not do |
| The deploy record | Written from the GitHub deployment: surface, sha, digest, approver, time, previous digest. One field is new: the digest |
| `GATEWAY_SHA` | Still a build argument, now set by the workflow from the commit it checked out |
| Plugin rollouts | Unchanged by this spec. They join the pipeline as surfaces when they become images (SCRUM-390) |

## 8. Part 5: the smallest step that proves the pipeline

One surface (the gateway), one artifact, one approved deploy, one rollback, measured.

| # | Step | Measured or verified | Rollback |
|---|---|---|---|
| 1 | Settings: protection on `main`, merge styles, fork approval, allowed actions | A scratch pull request that fails the gate cannot merge; one that passes can; a squash is not offered | Revert the settings |
| 2 | `ci.yml` and `gate.sh` merged | The check is seen **red** on a deliberately failing pull request before it is trusted green. Wall time of the job | Revert |
| 3 | Build job merged. Build the image for the sha that is **running** | Build time; image size; the image's revision label equals the sha | Delete the package version |
| 4 | Host prepared by a person: deploy user, restricted key, host script, compose reading the image variable, with the variable set to the image that is running now | A dry connection with the key runs the script's `--check` and nothing else; a request for a shell is refused; a malformed sha is refused | Remove the user; restore the compose file |
| 5 | **First approved deploy, its own go:** the GitHub-built image of the sha already running | Time from approval to healthy. The running container's image is the requested digest. A test run before and after diffs to zero. The only intended difference is who built the image | The host script's `--previous`, which is the host-built image |
| 6 | **Rollback through the pipeline, approved:** the `rollback` flag, back to the host-built image; then forward again, approved | Time from approval to healthy for each. No build ran and nothing was pulled on the way back | The fallback script |

Cost, stated plainly: steps 5 and 6 are three gateway restarts, and each drops every live MCP
session. They belong in one quiet window. A rollback that has never been run is not a
rollback, which is why step 6 is in the first step and not left for the day it is needed.

Only after step 6 does the next real gateway change ship through the pipeline.

## 9. Order, and how this meets SCRUM-390

1. Section 8, steps 1 and 2: the gate and the settings.
2. The machine account (section 6), before the approval is relied on.
3. Section 8, steps 3 to 6: the gateway through the pipeline.
4. SCRUM-390's import, which needs the merge-style setting from step 1 already in place.
5. SCRUM-390's plugin images, which reuse this pipeline with two more surfaces.

## 10. Risks

| Risk | What holds it down |
|---|---|
| The approval is treated as a control while the agents can click it | Refusal 3; section 6; decision 1 |
| SSH is reachable from the internet | Key-only, a user that owns nothing, a forced command, the host key pinned by the caller. This port is already how deploys reach the host today |
| A stolen deploy key redeploys an old, weaker image | Without the `rollback` flag the host script refuses any sha that is not newer than the current one; with it, only the recorded previous image. So the key can reach two images, the current and the one before |
| An image built by GitHub behaves unlike the one built on the host | Step 5 deploys the same sha and diffs a test run before anything new ships |
| The host script drifts from the copy in the repo | The script prints its own checksum in every job output; the report of a deploy records it |
| A dependency of a workflow is compromised | GitHub-owned actions only, pinned by sha; the build job has no deploy secret; the deploy job runs no third-party code |
| Registry or GitHub outage during an incident | Five images per surface on the host; the fallback path needs neither |
| A green check is read as "the security gate passed" | The table in section 3; decision 3 wires the leak scan |

## 11. Decisions needed

1. **The machine account for agent sessions** (section 6). Recommended, and a precondition
   for calling the approval a gate.
2. **Public or private images.** Public recommended: no pull credential on the host.
3. **Wire the leak scan into the workflow with its list as a secret**, now or as a follow-up.
   Recommended as the change right after section 8.
4. **Who else may approve.** One reviewer means no deploy while that person is away. A
   second person as a second reviewer is the obvious answer; it is a people question, not a
   technical one.
5. **The first-step window** (section 8, steps 5 and 6): three restarts, to be scheduled.
