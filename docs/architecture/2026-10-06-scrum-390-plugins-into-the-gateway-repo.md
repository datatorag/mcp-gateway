# SCRUM-390: the plugins move into the gateway repo

Status: SPEC, revision 4 (2026-10-08): the review's rulings are applied. No code has moved, nothing is deployed, the deploy script
is untouched. Written against `main` at `c82f58c`, `gws-mcp` main at `27ea0fc`, `atlassian-mcp`
main at `b8b82a0`.

Two things are decided and not reopened here. `gws-mcp` and `atlassian-mcp` become pnpm
workspace packages at `plugins/gws-mcp` and `plugins/atlassian-mcp`, history kept. And each
plugin runs as **its own container from its own image**, built by GitHub and rolled back by
image, which is what makes it a deploy unit with its own rollback id.

**What revision 3 changed.** Revisions 1 and 2 kept the plugins inside the gateway container
and designed a release mechanism for a folder in a volume: immutable directories, a symlink,
a one-off build container, a release script. That whole mechanism is gone. It existed only
because the plugins ran inside the gateway's process tree, and a design that moves them out
needs none of it. What it cost to drop: a rehearsed release-directory layout, never built and
never on the host. What carries over unchanged: the import, the port, the wiring, the registry
command and the gate script.

**How to read the claims.**

- *Read*: taken from the code or config at the shas above.
- *Rehearsed*: run on a laptop in throwaway clones and throwaway containers, all deleted. That
  proves commands, package layout and container behaviour at idle. It is not the host, not its
  architecture, and not real traffic.
- *Proposed*: design nothing has exercised. Every host-side step is in this class. No pass of
  this spec connected to the host.

The build-and-deploy pipeline this spec relies on is specified separately, in
`2026-10-07-scrum-394-ci-gates-and-github-deploys.md` (SCRUM-394).

**Direction, ruled: a connector is a service plugin of the gateway, not a standalone MCP
server.** The repository is public for openness, not as a supported way to host a connector on
its own. Four consequences are in this work, and one is not:

| Ruled | Where it lands |
|---|---|
| The folder is `plugins/` | Section 3 |
| Copy that describes running a plugin as a standalone server is swept | The wiring PR (step 7): READMEs and docs only, no code |
| The `.mcpb` desktop bundle is retired | Step 12, the first real plugin release |
| The `gws` CLI fallback is dropped; what its oracle test checks is kept as recorded fixtures | Step 12 |
| Registry rows generated from the tool list | **Not in this work.** Its own ticket |

The two code removals wait for step 12 on purpose. They change plugin code and may change the
served tool list, and steps 8 to 11 prove the new images by showing they serve exactly what
runs today. Removing code first would take that proof away.

## 1. What this spec refuses

1. **Plugins are not baked into the gateway image.** One image is one rollback id for three
   surfaces.
2. **The import PR is never squash-merged or rebase-merged.** A squash flattens the history
   the move exists to keep; a rebase rewrites every imported sha, including the ones old
   rollback ids name. Turning both off on the repository is a precondition (SCRUM-394), not a
   habit.
3. **No history rewrite on the way in.** Plain `git subtree add` keeps every plugin sha
   resolvable in this repo (rehearsed). A path-rewriting import would not.
4. **Location and content never change in the same commit.** The two import commits carry
   trees byte-equal to the plugin repos' tips. Wiring is a second PR.
5. **No general `plugin-sdk` in this work.** The contract between the gateway and a plugin was
   never written down; `packages/plugin-contract` is where it will be, after the move.
6. **No toolchain unification during the move.** The plugins keep NodeNext, `.js` import
   suffixes, `server/` as output and their own TypeScript majors (7 and 5).
7. **The registry write stays a human's.** One command generates the file. Nothing here runs
   SQL against production.
8. **The security gate and the leak scan are never path-filtered.**
9. **The gateway never gets the Docker socket.** It cannot read another container's labels or
   files, and it must not be able to. A plugin states its own commit over HTTP (section 4).
10. **The container address is not switched by editing a database row.** The code already has
    a branch for it, and using it would cost a production write per cutover and break the tool
    pages (section 4).
11. **A plugin container gets no secret.** Today a plugin child inherits the gateway's whole
    environment. A container gets a port number and nothing else.
12. **This does not claim the rollout of a new tool gets shorter.** It is still plugin, then
    registry row, then gateway. What collapses is three branches, three gates and three
    ancestry checks into one.
13. **The old repos are not deleted,** and not archived until both plugins are serving from
    images built here.

## 2. Today, from the code

| Fact | Where it is read |
|---|---|
| Workspace is `apps/*` and `packages/*`; turbo `build` outputs are `dist/**` and `.next/**` | `pnpm-workspace.yaml`, `turbo.json` |
| The gateway imports nothing from a plugin and no plugin imports from the gateway | `apps/gateway/package.json`; grep for the two slugs |
| A plugin on the host is a git checkout in a volume, compiled in place inside the gateway container and started as a child process of the gateway | `plugin-manager.ts`, `deploy` skill |
| A plugin release therefore restarts the gateway, which drops every MCP session and everything held in process memory | `ops-debugging` skill |
| Every plugin address is built in one function, called from three places. It returns `localhost` and the registry's port when the row has a repo URL, and a container hostname when it does not | `buildPluginServerUrl` in `user-tools.ts`; grep for its callers |
| `startAll()` skips, with a warning, any active plugin whose directory is missing | `plugin-manager.ts` |
| Both plugins listen on all interfaces, answer `GET /health` with `{"status":"ok"}`, and read only `PORT` from the environment on the hosted path | each plugin's `src/index.ts`; grep for `process.env` |
| A plugin call that throws is logged with its URL, recorded as thrown, and returned to the caller with the raw error text | `mcp-server.ts`, the CallTool catch |
| A test run records each plugin's sha by reading `<slug>/.git/HEAD` | `tests/plugin-sha.ts` |
| `PLUGIN_MCP_URLS` (`slug=url,...`) is read by one test, `registry-ground-truth.test.ts`, and by nothing in the running gateway | grep |
| That test compares tool **names only**, and reports skipped when the variable is unset | the test file |
| No repository of the three has a CI workflow | no `.github/` directory in any of them |

Three things today's layout hides:

- **The generator for registry change files is in none of the three repos.** Each rollout's
  guarded statements came from a script that lived in a session. (Searched: the three repos'
  tracked files and the private ops scripts. Not searched: session scratch.)
- **The skills describing the plugins have drifted from the plugins.** `gws-mcp-dev` says npm,
  the CLI binary on every call, and binaries downloaded during `build`; the plugin's own
  `CLAUDE.md` says pnpm, direct REST calls with a token, and an opt-in download.
- **`plugin-manager.install()` clones a repo and expects the manifest at its root.** Nothing
  calls it since the public install routes were removed. Nothing here relies on it.

## 3. Layout

| Thing | Becomes | Why |
|---|---|---|
| Directory | `plugins/gws-mcp`, `plugins/atlassian-mcp` | The directory name stays the slug, which is in `mcp_servers.slug`, every namespaced tool name and `PLUGIN_SERVICE_MAP` |
| `package.json` name | `@datatorag-mcp/gws-mcp`, `@datatorag-mcp/atlassian-mcp` | Workspace scope. Nothing resolves a plugin by package name at runtime |
| `package.json` `files` | `["server", "datatorag.json", "README.md", "LICENSE"]` | `server/` is gitignored; without `files` the image's packaging step would leave it out (rehearsed with it) |
| Lockfiles | Both per-plugin lockfiles (each plugin tracks an npm one and a pnpm one) are deleted; the root `pnpm-lock.yaml` gains two importers | One lockfile |
| Workspace | add `"plugins/*"` to `pnpm-workspace.yaml` | |
| `turbo.json` | add `server/**` to `build.outputs` | A cache hit restores only declared outputs, so without this a cached plugin build leaves `server/` stale or absent and exits 0 |
| tsconfig | Each plugin keeps its own. Neither extends `tsconfig.base.json` | The base sets bundler resolution; the plugins run under plain `node` |
| Lint | Nothing to share | No package in any of the three repos has a lint script or config |
| Image | One `plugins/Dockerfile`, taking the plugin as a build argument | Rehearsed as one file for both. Section 4 |
| Gateway image | Its `Dockerfile` copies each plugin's `README.md` and nothing else from `plugins/` | The tool pages read the README at build time (ruled). `gate.sh` fails if it copies anything more |
| `.mcpb` desktop bundle | Imported as it is, then retired at step 12 | Ruled. No GitHub release of it exists, so no download link breaks |

**Build and test.** `pnpm -r build` and `pnpm -r test` work once the glob is added (rehearsed).
`turbo run build --filter='...[<base>]'` selects exactly the changed package and its dependents
(rehearsed: a plugin-only commit selects that plugin alone; a `packages/types` commit selects
`types` and the gateway).

**Two things the rehearsals found that a reading would not:**

- **The move is not a no-op for dependencies.** Re-resolving under the root lockfile moved
  four transitive production packages of `gws-mcp` forward (`ajv`, `jose`, `zod`,
  `eventsource-parser`). They are pinned for the first images built here and unpinned later as
  a change of its own. The pin that works (rehearsed, production package list then identical,
  91 of 91): `pnpm.overrides` for three of them, and `zod` declared as a direct pinned
  dependency of the plugin, because it arrives only as an auto-installed peer of the MCP SDK
  and an override did not move it. `atlassian-mcp`'s drift was not measured.
- **A fresh checkout's `pnpm -r test` is red.** The `gws-mcp` oracle test fails, by design
  never skips, when the pinned CLI binary is absent, and the binary is a gitignored download.
  Until step 12 drops the CLI, the plugin's `test` task depends on `download-binaries`. After
  it, the oracle's expected requests are fixtures in the repo and nothing is downloaded.

**What the gateway and the plugins share.**

| Shared by copy today | After the move |
|---|---|
| The file-crossing wire contract: two private route paths, the token header, the arguments header, the `{error, code}` answer, the byte cap. Three copies | **`packages/plugin-contract`**: constants and types only, built to `dist/` like its siblings. The one package that falls out. A follow-up PR, because it changes plugin code |
| Tool names: plugin tool arrays against the gateway's classification, snapshot and runner cases | No package. CI saves each image's `tools/list` (section 5), and a gateway test compares against that file |
| Google scope list, in the gateway and twice in `gws-mcp` | A test across the tree, not a package |
| Response helpers, annotation presets | Left alone. Each plugin has its own and they are not copies |

## 4. Deploy: each plugin is a container

### The options

| | A. Folder in the gateway's volume (revisions 1 and 2) | B. Inside the gateway image | **C. Own container, own image** |
|---|---|---|---|
| Rollback id | Per surface | One for everything | Per surface: an image digest |
| Plugin release restarts the gateway | Yes | Yes, and rebuilds it | **No** |
| Built where | On the host, in a one-off container | On the host | By GitHub; nothing compiles on the host |
| New machinery | Release directories, a symlink, a release script, a build container | None | Two compose services and one `Dockerfile` |
| Plugin sees the gateway's secrets | Yes, inherited | Yes | No |
| Memory accounting | Inside the gateway's limit | Inside the gateway's limit | Its own limit |

A and B share one assumption: the plugin is a child of the gateway process. C drops it.

**This absorbs SCRUM-393** (restart one plugin without restarting the gateway). Under C that is
`compose up -d <slug>`, with no gateway code involved. Rehearsed: one plugin container
restarted and answering again in about six seconds while the other was untouched. What is
*not* absorbed: a gateway deploy still drops every session, exactly as today.

### The image (rehearsed on a laptop)

One multi-stage `plugins/Dockerfile`. The build stage installs that plugin's dependencies from
the root lockfile, compiles, and runs `pnpm deploy --prod` to produce the compiled output, the
manifest and a production-only `node_modules`. The final stage is `node:20-slim` with that
directory, a non-root user and `CMD ["node", "server/index.js"]`. The commit is a build
argument, kept in the image's revision label and in an environment variable the plugin reports.

| Measured | `gws-mcp` | `atlassian-mcp` |
|---|---|---|
| Build | 8 s, dependency store warm | 15 s, built first and so including the download |
| Image size | 237 MB | 236 MB (the Node base image is most of it) |
| Tools served from the image | 68 | 24 |
| Memory at idle, as the container runtime counts it | 28 MiB | 23 MiB |

Both ran with a 256 MB limit, a read-only root filesystem, every capability dropped, and as
uid 1000. That is idle behaviour only: no tool call with a real token ran, so a write to disk
or a memory peak under load was not exercised.

### Compose (proposed)

Two services are added to `docker-compose.prod.yml`. Nothing else in it changes except the
gateway's environment list and, at the end, the volume line.

| | `gws-mcp` | `atlassian-mcp` |
|---|---|---|
| Image | `${GWS_MCP_IMAGE}`, a digest reference written by the host script | `${ATLASSIAN_MCP_IMAGE}` |
| Network | The existing `dtrmcp` network (`datatorag-mcp-network`), nothing else | Same |
| Port | 40000 inside the network, `expose` only | 40001, `expose` only |
| Published on the host | Nothing. Only the gateway publishes a port | Nothing |
| Environment | `PORT`, and the commit from the image. No secret | Same |
| Health check | `GET /health` on its own port, same form as the gateway's | Same |
| Hardening | Read-only root filesystem with a tmpfs `/tmp`, all capabilities dropped, no new privileges, non-root | Same |
| Memory | Limit 512 MB to start, swap limit equal (no swap); set properly after measurement under real calls | Same |
| Restart | `unless-stopped` | Same |

The ports keep the numbers the registry rows hold today. The gateway has **no** `depends_on`
toward the plugins: it must come up and serve the site, sign-in and its own tools whether or
not a plugin is healthy, which is the same decoupling it already has from the database.

Anything on that network can reach a plugin's port. Today that is the gateway and the two
plugins. A plugin call is useless without a user's token, and the private file routes refuse a
tokenless request (rehearsed: 401), but the network is the boundary and a future service
joining it should be a deliberate act.

**Memory on the host.**

| Container | Limit | Basis |
|---|---|---|
| Gateway | 3072 MB | Read from the compose file. Today this limit also covers both plugin processes |
| `gws-mcp` | 512 MB to start | A deliberately loose starting value, not a finding. Idle is measured at 28 MiB on a laptop. The peak is an **estimate**: this plugin holds one file of up to 25 MB in memory during a crossing, with encoding overhead, so on the order of 100 to 150 MB |
| `atlassian-mcp` | 512 MB to start | Same. Idle measured at 23 MiB; it receives the same file |
| Total of limits | 4096 MB to start | Arithmetic. Whether the host has that much headroom is in the report, not here |

Ruled: the limits are set from measurement **under real tool calls**, not idle. The cutover's
test run (steps 10 and 11) exercises every tool, the largest file crossing included; the peak
it records sets each limit, with stated headroom, as a follow-up deploy of that one service.

### How the gateway finds a plugin

`buildPluginServerUrl` learns one thing: if `PLUGIN_MCP_URLS` names the slug, that URL wins.
`startAll()` skips any slug it names. The variable has the format the ground-truth test already
parses, and it is set literally in the compose file (`gws-mcp=http://gws-mcp:40000/mcp,...`):
it is an address, not a secret, so it does not go through the parameter store, but it must be
in the gateway service's explicit environment list or it never reaches the process.

Two corrections to how this was first framed:

- **The running gateway does not read `PLUGIN_MCP_URLS` today.** One test does. The override
  is new code, small, in the one function every caller already uses.
- **The existing container branch is not used.** `buildPluginServerUrl` already returns a
  container hostname when a row's repo URL is null. Flipping it means a production write per
  cutover and per rollback, and it nulls the column the tool pages read for their source link
  and README. An environment entry is reversible by a restart and touches no data.

### How a test run learns a plugin's commit

Not from an image label and not from a file in the image: the gateway cannot see either
without the Docker socket (refusal 9). `GET /health` on the plugin returns its commit, from the
build argument, alongside `status`. `plugin-sha.ts` asks over HTTP when the slug has a URL and
keeps the git reader for a local checkout. This is also the better source: it is what the
running process says, not what a directory says.

### When a plugin container is down or restarting

| Situation | Today (read, and rehearsed for the error text) | Proposed |
|---|---|---|
| `tools/list` | Served from the registry | Unchanged: the tools stay listed |
| A call while the port is closed or the name is gone | Throws `fetch failed` (cause `ECONNREFUSED` or `ENOTFOUND`); the caller gets that raw text | Both causes mean nothing was sent. Wait about two seconds and try once more; this is safe for a write too. If it still fails, answer in words that the connector is restarting, as an error result |
| A call cut off mid-flight | The same raw error | **No retry.** The plugin may have acted. The worded error says the call may or may not have completed |
| A file crossing | Fails on the leg it was in, and says which | Unchanged |
| Gateway boot with a plugin down | A missing directory is skipped | The gateway starts; calls to that plugin fail as above until it is back |
| A plugin that keeps crashing | The gateway respawns three times and logs | Docker restarts it, and the gateway raises an alert (below) |

The wording of those two error sentences goes through the repo's outbound copy rules.

**The restart-loop alert** (ruled; proposed design). The gateway cannot see Docker, so the
plugin tells it: `/health` also returns the time the process started. The gateway checks each
plugin once a minute on its existing scheduler and posts to the existing alerts channel when a
plugin has been unreachable for three checks running, or its start time has changed three
times in ten minutes. One alert per episode, and one when it recovers.

### What a plugin release becomes

The plugin is one more surface in the SCRUM-394 pipeline. A merge that touches
`plugins/<slug>/**` or the lockfile builds its image, tagged by commit. A dispatch names the
surface and the sha, the production environment holds it for approval, and the host pulls by
digest and runs `compose up -d <slug>`. Rollback is the same dispatch with the rollback flag.
The gateway is not restarted and no session is dropped.

Because an image is immutable, "the process is serving what was built" stops being something
to check with a second tool listing: the host script confirms the container was recreated
from the requested digest, and that is the same statement.

What the image cannot say is whether the **registry** agrees with it. So a plugin release ends
with the ground-truth check, run from inside the gateway container where the database and the
plugin addresses both are: the registry must list exactly the tools the plugin now serves. A
difference fails the release job and rolls nothing back, because the repair is a registry
write and that is a person's. The check compares names; a changed description or schema is
what `registry:diff` is for.

**The record.** A deploy row names `surface` (`gateway`, `plugin:gws-mcp`,
`plugin:atlassian-mcp`, `registry`), the monorepo `sha` and the image digest.

### What goes away

| Gone | Why it existed |
|---|---|
| The checkout in the volume, compiling inside the production container, and the "was it actually rebuilt" check | The plugin was built where it ran |
| Restarting the gateway to release a plugin | The plugin was the gateway's child |
| Revision 2's release directories, symlink, `release-plugin.sh` and one-off build container | To give a folder a rollback id |
| The `plugins-data` volume | Removed from the compose file at close-out, after both cutovers have held |
| Plugin memory counted against the gateway's limit | Same process tree |

`plugin-manager`'s spawn path stays for local development, where a plugin is still a checkout
on a laptop.

## 5. Registry

**Today.** A plugin change that alters a tool's description, schema or existence needs a
change file: one guarded statement per row (the guard is the md5 of the description and of
`input_schema_json::text` as the old build produces them), a row-count assertion,
`updated_at = now()`, and a rollback file. It is generated from two builds of the plugin repo
by a script kept in none of the repos.

**After.** When CI builds a plugin image it boots it, asks it for `tools/list` (the served
list, not the source array: a plugin can withhold a tool it defines), and saves the answer as
`tools.json` beside the image, with its digest in a label. Then one command in this repo:

```
pnpm registry:diff <slug> --from <sha> --to <sha>     # writes forward.sql and rollback.sql
```

It compares the two shas' `tools.json`, fetched from CI and from nowhere else, and emits the
same guarded statements used today, headed NOT RUN. It never
opens a database connection. `--from` is the sha of the image that is running.

The generator has one hard part and it gets a self-test: the guard must reproduce Postgres's
`jsonb::text` rendering exactly, or every guard misses and the file safely does nothing.
Fixtures are public tool schemas with their known md5s.

**The drift gate and where a tool comes from.**

| Place | Assumption | After |
|---|---|---|
| `registry-ground-truth.test.ts` | Slug to URL from `PLUGIN_MCP_URLS`; no repo assumption | The variable is now set in the gateway container, and the check runs at the end of every plugin release (section 4). Its blind spot stays: names only |
| `tests/plugin-sha.ts` | A plugin directory is a git checkout | Asks the plugin (section 4) |
| `/tools/[slug]` page | README from the plugin's directory on the gateway's disk, else GitHub's README for the repo in the registry row | Ruled: one README per plugin, copied into the gateway image at build and read from there. The GitHub fallback is removed, so a page never shows an archived repo's text. A README edit is a gateway change |
| `mcp_servers` repo columns | One repo per plugin; non-null means "runs locally" | Left as ruled. The URL override makes the "runs locally" reading irrelevant for named slugs |
| Skills (`deploy`, `ops-debugging`, `gws-mcp-dev`, `codebase-map`) | Separate repos, checkout in the volume | Rewritten in the PRs that change each fact (freshness rule) |
| Ops scripts kept outside this repo | They reach a plugin on `localhost` from inside the gateway container, and assume a checkout to inspect | Swept at the cutover; listed in the report, not here |

A new tool is still: plugin release, then the INSERT, then the gateway that classifies it.

## 6. Gates

One range, one script: `scripts/gate.sh [base]`. SCRUM-394 specifies the workflow that runs it
on every pull request, the protection on `main`, and what a green check does and does not
mean. This spec owns the path table.

| Changed path | Surface | Runs | Image built on merge |
|---|---|---|---|
| `plugins/<slug>/**` | `plugin:<slug>` | That plugin's build and tests | That plugin's |
| `plugins/<slug>/README.md` | `gateway` as well | Gateway tests | The gateway's too |
| `apps/gateway/**` (content included), `packages/**`, `docker/**` | `gateway` | Gateway tests, typecheck, production build | The gateway's |
| `pnpm-lock.yaml`, root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `plugins/Dockerfile` | every surface | Everything | All |
| `docs/**`, `.claude/**`, `scripts/**` | none | The hook scripts' own tests when `scripts/hooks/**` changes | None |

Always, on the whole range and never filtered: the ancestry check, the security reviewer, the
leak scan. A path filter decides what is built and tested. It never describes what a deploy
does: a gateway deploy still restarts the gateway, whatever the diff was.

## 7. Migration

Order: the pipeline first, then the source moves, then the plugins become containers.

**Phase 0: before the import (SCRUM-394, plus one gateway PR).**

| # | Step | Verification | Rollback |
|---|---|---|---|
| 1 | **CI gate and repository settings**: `gate.sh` (gateway rows), the leak scan, the workflow, `main` protected, squash and rebase off | As SCRUM-394 section 8, steps 1 and 2: each check is seen red before it is trusted green; a squash is not offered | Revert |
| 2 | **The pipeline, proven on a canary, then the gateway through it** | As SCRUM-394 section 8, steps 3 to 7 | The existing deploy script |
| 3a | **Gateway prep, the inert half**, deployed through the pipeline: the `PLUGIN_MCP_URLS` override and `startAll` skip, and the plugin commit read over HTTP. Nothing changes until the variable is set | Its tests, with a known-bad case (an entry without `=`). After the deploy a test run is unchanged and still records both plugin shas from git | The pipeline's rollback |
| 3b | **Gateway prep, the active half**, its own PR and deploy: the single retry, the two worded errors, the restart-loop alert. This one changes behaviour for today's spawned plugins too | Its tests, with a known-bad case (a retry attempted after bytes were sent must fail the test). A plugin child killed by hand on a local gateway produces the retry, then the worded error | The pipeline's rollback |

**Phase 1: the source moves. Nothing deploys.**

| # | Step | Verification | Rollback |
|---|---|---|---|
| 4 | **Freeze the plugin repos.** Record both `main` tips. Lock `main` on each | A push to `main` is refused | Remove the rule |
| 5 | **Import PR**, two commits and nothing else (commands below), merged as a merge commit | `git rev-parse HEAD:plugins/<slug>` equals `<tip>^{tree}` in the plugin repo, for both. The old shas resolve. Commit count is the three counts plus two. Leak scan and security gate over the whole range. `git status` clean | Do not merge; after merge, revert the two commits. `plugins/` is inert: not in the workspace, not in any image |
| 6 | **Port what is kept**: `git format-patch` in the old repo, `git am --directory=plugins/<slug>` here | The ported branch's `plugins/<slug>` tree equals the source branch's tree | Delete the branch |
| 7 | **Wiring PR**: workspace glob, package names, `files`, lockfiles, the pins, `turbo.json`, plugin rows in `gate.sh`, the skills, each plugin's `CLAUDE.md`, and the sweep of standalone-server copy | Frozen install is clean. Test totals per plugin equal the pre-move totals at the same source. Gateway suite, typecheck and build unchanged. The production package list of each plugin equals the one its old lockfile gives | Revert the PR |

**Phase 2: the plugins become containers.**

| # | Step | Verification | Rollback |
|---|---|---|---|
| 8 | **Image PR**: `plugins/Dockerfile`, `/health` reporting the commit and start time, the CI build with `tools.json`, `registry:diff`, the two compose services, the READMEs copied into the gateway image. The gateway is not pointed at the plugin containers | Both images build in CI. Each `tools.json` equals, tool for tool (name, description, schema, read-only hint), what the plugin repo's own build serves at the frozen tip | Revert the PR |
| 9 | **Side by side on the host.** Pull both images and start both containers. No traffic reaches them | Both healthy. From inside the network each container's tool list equals the **running** in-gateway plugin's, tool for tool. The private route refuses a tokenless call. The ports do not answer from outside the host. Idle memory read over a day | `compose rm -sf` the two services |
| 10 | **Cut over `atlassian-mcp`, its own go.** Baseline test run. Add its entry to `PLUGIN_MCP_URLS`; restart the gateway once | Post run diffs to zero regressions. The recorded plugin sha is now the monorepo sha, from the plugin. The call log shows the container's address. No child process for that slug. One live read. Then the **restart drill**: recreate the plugin container with a session open. The session survives, a call during the gap gets the retry or the worded error, and time to healthy is recorded. The container's peak memory over the test run is recorded, and its limit is set from it afterwards | Remove the entry, restart the gateway. It spawns from the checkout, which is still in the volume |
| 11 | **Cut over `gws-mcp`, its own go.** Same | Same, plus one Gmail read, and one email filed on a Jira issue end to end, since both legs of a crossing are now separate containers | Same |
| 12 | **First real plugin release through the pipeline, its own go: the service-plugin cleanup of `gws-mcp`.** The `.mcpb` bundle, the stdio entry point, the CLI fallback and its download go; the oracle's expected requests become fixtures | Approved; the plugin container is recreated from the requested digest; the gateway's start time is unchanged. `registry:diff` between the two `tools.json` says exactly which tools changed, and if any did, the change file exists before the release and is run by a person after it. The ground-truth check passes. Then a rollback dispatch back and forward | The rollback dispatch |
| 13 | **Close out.** Remove the volume from the compose file. Old repos: a final README commit naming the new home, open issue transferred, then **archived**. Deploy records. The pins come out later as their own change | The archived repos refuse a push. A fresh clone builds and tests both plugins. The gateway restarts cleanly with no volume | Unarchive; the volume's data is kept for a stated period before deletion |

**Does each step prove one new thing?** Steps 1 to 9 do. Steps 10 and 11 do not: at a cutover
a plugin changes both where it runs (child process to container) and what it was built from
(the plugin repo to this one). Building containers from the old repos first would split that
and was ruled out, so the two are separated by evidence instead: step 7 holds the dependency
list fixed, step 8 holds the served tools equal to the old build's, and step 9 holds them equal
to what is running, all before a single call moves.

**The freeze window.** From step 4 to the cutover of each plugin, a plugin change cannot ship
the ordinary way: the old repo is locked and the new images are not serving. That window should
be days. The emergency path is the old one: unlock, commit there, roll out as today, and port
the commit. A plugin change already in flight (`gws-mcp` has one today) ships before step 4 or
is ported in step 6 and waits.

```bash
# Step 5. Run from a branch off main; <tip> is the frozen main sha of each plugin repo.
git subtree add --prefix=plugins/gws-mcp       https://github.com/datatorag/gws-mcp.git       <tip>
git subtree add --prefix=plugins/atlassian-mcp https://github.com/datatorag/atlassian-mcp.git <tip>
```

No `--squash`. Rehearsed at today's tips: both directories byte-equal to their sources, every
original sha present, `git blame` attributes lines to the original commits.

**What history looks like afterwards** (rehearsed, and the cost of refusal 3): `git log --
plugins/gws-mcp/src/tools/gmail.ts` shows only the import commit, and `--follow` shows nothing.
The file's real history needs `git log --full-history -- src/tools/gmail.ts
plugins/gws-mcp/src/tools/gmail.ts`, or `git log <old-tip> -- src/tools/gmail.ts`. This goes in
the plugin skill.

**Branches on the old repos** not merged into `main` as of 2026-10-06, from `git ls-remote`:

| Repo | Branch | Ruling |
|---|---|---|
| `gws-mcp` | `scrum-392-sheets-coercion-sentence` | Keep. Ships before step 4, or ported in step 6 (rehearsed: resulting tree equal to the source) |
| `gws-mcp` | `feature/chore/gws-cli-0.22.5` | Keep; ported in step 6. Its unpushed local commits are pushed first, or they are not in the port |
| `gws-mcp` | `scrum-278-gmail-signature` | Drop. Readable in the archive |
| `atlassian-mcp` | `feature/fix/jira-search-response-shape` | Drop. Its fix is already on `main` |

Local-only branches and a stash exist on the development machine; an import cannot see them.

**Local development after the move.** A laptop's plugin directory is a clone today. It becomes
a link from `~/.datatorag/plugins/<slug>` to `plugins/<slug>` in one checkout, built in place
and spawned by the gateway as now.

## 8. If the pending branches land first

| Branch | Touches | Effect on this spec |
|---|---|---|
| `chore-deploy-prune-build-cache` | `deploy-gateway.sh`, `deploy` skill | None here. SCRUM-394 retires host builds, which makes the chore moot once it lands |
| `chore-remove-compose-postgres` | Prod compose loses the database services | The compose edits in section 4 and in SCRUM-394 rebase onto it. It keeps the volume line that step 13 removes |
| SCRUM-384 spec branch | One architecture document | The prose form of the contract `packages/plugin-contract` encodes |
| Notion connector (SCRUM-366), a design and a plan on its branch | No code yet | Born at `plugins/notion-mcp` as a third container. Its plan's step creating a plugin repo becomes a directory, a compose service and a row in the path table |

## 9. Risks

| Risk | Likelihood | What holds it down |
|---|---|---|
| The first images differ from what runs because dependencies re-resolved | Seen in rehearsal (four packages) | The pins; steps 7, 8 and 9 compare before any call moves |
| The container behaves unlike the laptop: architecture, the read-only filesystem under a real tool call, memory under a file crossing | Unknown: idle only was rehearsed | Step 9 runs both containers on the host with no traffic; the test run at steps 10 and 11 exercises every tool; the limits are revised from measurement |
| A plugin call fails during a release | Certain, for a few seconds | The retry and the worded error (step 3); the restart drill measures the gap |
| A retry repeats a write | Would be a defect | Retry only when nothing was sent; a test with a known-bad case pins it |
| Step 12 removes a tool without anyone noticing | Possible: one tool exists only for the standalone login | `registry:diff` names every tool that differs before the release; the ground-truth check fails after it if the registry was not brought along |
| A plugin crash-loops unnoticed | Possible | The restart-loop alert (step 3b) |
| The freeze window stretches | Likely if steps 8 and 9 surprise | The emergency path; phase 0 is done before the freeze so nothing in the window is being built for the first time except the image PR |
| A cached turbo build leaves `server/` stale | Certain without the `outputs` line | Section 3; the image build runs in a clean container with no turbo cache |
| Someone commits to an old repo after the import | Likely over weeks | Branch rule at step 4, archive at step 13 |
| A leak sits in imported history or commit messages | The repos are already public, so the import publishes nothing new | The scan still runs over the range. A finding is an existing exposure to rotate and report |
| The root lockfile couples surfaces: any dependency bump rebuilds every image | Certain, and accepted | Conservative on purpose; an unchanged plugin's rebuilt image has the same `tools.json`, and nobody has to deploy it |

Not addressed, on purpose: the names-only blind spot of the in-repo ground-truth test; removing
the dead install path from `plugin-manager`.

## 10. Rulings, and what is still open

Ruled: plugins as their own containers; connectors are service plugins, with the four
consequences listed at the top; the import, port and wiring as specified; the dependency pins
for the first images; one README per plugin read at build time; a restart-loop alert; memory
limits set from measurement under real tool calls; `registry:diff` reading CI's `tools.json`
only; the ground-truth check at the end of every plugin release; the gateway prep split in two;
the branch rulings in section 7.

Open: a separate go for each of steps 2, 10, 11 and 12.
