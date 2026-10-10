# SCRUM-390: the plugins move into the gateway repo

Status: SPEC, revision 7 (2026-10-09): revision 6 with its six open questions ruled (section
10 is closed) and step 3 specified in full. **Ruled on 2026-10-09: the plugins stay inside the
gateway container.** They are built from this repository into the gateway image: one image,
one deploy, one rollback id. Each plugin process is started with only its own environment
variables, never the gateway's keys. This reverses the half of revision 3 that made each
plugin its own container; the pipeline half (SCRUM-394) stands and is built. Nothing in this
spec has been built: no plugin code has moved and no plugin deploy has changed. Gateway
facts were re-read at `main` `5856c3c`; plugin facts at `gws-mcp` main `27ea0fc` and
`atlassian-mcp` main `b8b82a0`.

Two things are decided and not reopened here. `gws-mcp` and `atlassian-mcp` become pnpm
workspace packages at `plugins/gws-mcp` and `plugins/atlassian-mcp`, history kept. And each
plugin **runs as a child process of the gateway, from a directory inside the gateway image**,
so a plugin change is a gateway deploy and is rolled back by rolling the gateway back.

**What revision 6 changed.** Revisions 3 to 5 moved each plugin into its own container with
its own image and rollback id. The ruling's reasoning: nobody reaches a plugin except through
the gateway, so scale was never the reason. The two real gains of separate containers were a
crashing plugin restarting alone and a plugin not seeing the gateway's keys. At two plugins of
our own code those do not pay for two more deploy units, per-plugin networks, a header-trust
change and host firewall rules. The second gain is kept another way, by scoping each plugin's
environment in code (section 4). The first is not kept beyond what exists today.

What goes with the container design: the plugin image and `plugins/Dockerfile`, the two
compose services, `PLUGIN_MCP_URLS` as a runtime override, the commit and start time on a
plugin's `/health`, the retry and the two worded errors for a plugin that is restarting, the
per-plugin memory limits, and the two per-plugin cutovers. What it cost to drop: a design
rehearsed on a laptop and never on the host. What carries over unchanged: the import, the
port, the wiring, the registry command and the gate script. The container design is kept as a
record in section 4, with what was measured, for the day a plugin is moved out. The layout in
section 3 keeps that day open: a plugin is one directory with its own package.

**Earlier revisions, in one line each.** Revisions 1 and 2 kept the plugins in the gateway
container and designed a release mechanism for a folder in a volume (release directories, a
symlink, a build container, a release script). Revision 3 dropped that for a container per
plugin. Revision 5 asked what such a container could reach on the shared network. Revision 6
keeps the plugins inside and needs neither mechanism: the folder is part of the image.

**How to read the claims.**

- *Read*: taken from the code or config at the shas above.
- *Rehearsed*: run on a laptop in throwaway clones and throwaway containers, all deleted. That
  proves commands, package layout and container behaviour at idle. It is not the host, not its
  architecture, and not real traffic. Every rehearsal cited here was done for an earlier
  revision; none was repeated for this one, and each says what it covered.
- *Proposed*: design nothing has exercised. Everything new in revision 6 is in this class, and
  so is every host-side step. No pass of this spec connected to the host.

The build-and-deploy pipeline this spec relies on is specified separately, in
`2026-10-07-scrum-394-ci-gates-and-github-deploys.md` (SCRUM-394), and is built.

**Direction, ruled: a connector is a service plugin of the gateway, not a standalone MCP
server.** The repository is public for openness, not as a supported way to host a connector on
its own. Four consequences are in this work, and one is not:

| Ruled | Where it lands |
|---|---|
| The folder is `plugins/` | Section 3 |
| Copy that describes running a plugin as a standalone server is swept | The wiring PR (step 7): READMEs and docs only, no code |
| The `.mcpb` desktop bundle is retired | Step 11, the first plugin change after the cutover |
| The `gws` CLI fallback is dropped; what its oracle test checks is kept as recorded fixtures | Step 11 |
| Registry rows generated from the tool list | **Not in this work.** Its own ticket |

The two code removals wait for step 11 on purpose. They change plugin code and may change the
served tool list, and steps 8 to 10 prove the plugins in the image by showing they serve
exactly what runs today. Removing code first would take that proof away.

## 1. What this spec refuses

1. **A plugin is not given the gateway's environment.** Today a plugin child inherits all of
   it. After step 3 it is started with a short list of names and nothing else (section 4).
2. **The import PR is never squash-merged or rebase-merged.** A squash flattens the history
   the move exists to keep; a rebase rewrites every imported sha, including the ones old
   rollback ids name. Both are off on the repository since SCRUM-394.
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
9. **Where a plugin is loaded from is not switched by a database row or a file on the host.**
   It is a value set in the image, so rolling the image back rolls that back too, and nothing
   else has to be remembered (section 4).
10. **No second deploy unit.** A plugin has no image, no compose service and no rollback id of
    its own. This is the ruling, written as a refusal so a later convenience does not undo it.
11. **Nothing compiles in the running container any more.** After the cutover a plugin is
    never pulled, installed or built inside production.
12. **This does not claim a plugin change gets cheaper to release.** It gets more expensive in
    one way: every plugin change is a gateway deploy, and a gateway deploy drops every MCP
    session. That is also true today, where a plugin release ends with a gateway restart.
13. **The old repos are not deleted,** and not archived until both plugins are serving from
    the gateway image.

## 2. Today, from the code

| Fact | Where it is read |
|---|---|
| Workspace is `apps/*` and `packages/*`; turbo `build` outputs are `dist/**` and `.next/**` | `pnpm-workspace.yaml`, `turbo.json` |
| The gateway imports nothing from a plugin and no plugin imports from the gateway | `apps/gateway/package.json`; grep for the two slugs |
| A plugin on the host is a git checkout in a volume, compiled in place inside the gateway container and started as a child process of the gateway | `plugin-manager.ts`, `deploy` skill |
| The plugins directory is fixed in code as `.datatorag/plugins` under the home directory, and the production compose file mounts a named volume there | `PLUGINS_DIR` in `plugin-manager.ts`; `docker-compose.prod.yml` |
| A plugin child is started with **the gateway's whole environment**, plus `PORT`, plus that plugin's rows in the `mcp_server_env_vars` table. A row whose value starts with `$` copies the named variable from the gateway's environment | `spawnPlugin` in `plugin-manager.ts` |
| A plugin child that exits unexpectedly is started again at once. The code means to stop after three crashes in sixty seconds, but the count is never kept between restarts, so the limit cannot be reached: a plugin that keeps crashing is restarted without end and without a pause, and the only trace is log lines. Read, not run; no test covers it | `spawnPlugin`, the exit handler |
| A plugin release therefore restarts the gateway, which drops every MCP session and everything held in process memory | `ops-debugging` skill |
| Every plugin address is built in one function, called from three places. It returns `localhost` and the registry's port when the row has a repo URL | `buildPluginServerUrl` in `user-tools.ts`; grep for its callers |
| `startAll()` skips, with a warning, any active plugin whose directory is missing | `plugin-manager.ts` |
| Both plugins listen on all interfaces and answer `GET /health` with `{"status":"ok"}`. `atlassian-mcp` reads only `PORT` from the environment. `gws-mcp` reads `PORT`, and its CLI client reads three more names and hands its whole environment to the CLI it starts | each plugin's `src/index.ts`; grep for `process.env` |
| A plugin call that throws is logged with its URL, recorded as thrown, and returned to the caller with the raw error text | `mcp-server.ts`, the CallTool catch |
| A test run records each plugin's sha by reading `<slug>/.git/HEAD` under the plugins directory | `tests/plugin-sha.ts`, `tests/execute.ts` |
| `PLUGIN_MCP_URLS` (`slug=url,...`) is read by one test, `registry-ground-truth.test.ts`, and by nothing in the running gateway | grep |
| That test compares tool **names only**, and reports skipped when the variable is unset | the test file |
| The gateway image keeps `git`, `curl`, `unzip` and `pnpm` at run time, because plugins are updated in place in the running container | `apps/gateway/Dockerfile`, its own comment |
| This repository has a required pull-request gate and builds its images in GitHub (SCRUM-394). The two plugin repos have no CI workflow | `.github/workflows/`; no `.github/` directory in either plugin repo |

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
| `package.json` `files` | `["server", "datatorag.json", "README.md", "LICENSE"]` | `server/` is gitignored. Not needed by the in-image layout below; kept because it is what a plugin image would package (rehearsed with it), and it costs one line |
| Lockfiles | Both per-plugin lockfiles (each plugin tracks an npm one and a pnpm one) are deleted; the root `pnpm-lock.yaml` gains two importers | One lockfile |
| Workspace | add `"plugins/*"` to `pnpm-workspace.yaml` | |
| `turbo.json` | add `server/**` to `build.outputs` | A cache hit restores only declared outputs, so without this a cached plugin build leaves `server/` stale or absent and exits 0 |
| tsconfig | Each plugin keeps its own. Neither extends `tsconfig.base.json` | The base sets bundler resolution; the plugins run under plain `node` |
| Lint | Nothing to share | No package in any of the three repos has a lint script or config |
| Image | **None of its own.** The gateway's `Dockerfile` builds both plugins and ships them at `/app/plugins/<slug>` | The ruling. Section 4 |
| Tool page README | Read from `plugins/<slug>/README.md` in the same tree the gateway is built from | Ruled earlier: one README per plugin, read at build time. It needs no copy step now, because the plugin is in the build |
| `.mcpb` desktop bundle | Imported as it is, then retired at step 11 | Ruled. No GitHub release of it exists, so no download link breaks |

**Build and test.** `pnpm -r build` and `pnpm -r test` work once the glob is added (rehearsed).
`turbo run build --filter='...[<base>]'` selects exactly the changed package and its dependents
(rehearsed: a plugin-only commit selects that plugin alone; a `packages/types` commit selects
`types` and the gateway). That selection is about what is compiled and tested. It says nothing
about what is deployed: a plugin-only commit still produces a new gateway image.

**Two things the rehearsals found that a reading would not:**

- **The move is not a no-op for dependencies.** Re-resolving under the root lockfile moved
  four transitive production packages of `gws-mcp` forward (`ajv`, `jose`, `zod`,
  `eventsource-parser`). They are pinned for the first image that carries the plugins and
  unpinned later as a change of its own. The pin that works (rehearsed, production package list
  then identical, 91 of 91): `pnpm.overrides` for three of them, and `zod` declared as a direct
  pinned dependency of the plugin, because it arrives only as an auto-installed peer of the MCP
  SDK and an override did not move it. `atlassian-mcp`'s drift was not measured.

  **What step 7 found and did instead (ruled 2026-10-09).** By the time of the move the
  gateway's own lockfile had moved on, and both drifts were measured against it. Under one
  lockfile a plugin takes the versions the gateway already resolves for the packages they
  share, and for `atlassian-mcp` that was *backward* for five of them. An override applies to
  the whole workspace, so pinning a plugin to its old versions would have moved the gateway
  backward instead. The rule adopted: **no production package moves backward anywhere.** (One
  development tool does: the plugins' test runner now uses the `vite` the gateway already
  resolves, 8.0.9, where their own lockfiles had 8.2.x. It is in no image.) Each of the five is
  overridden to the higher of the two versions, which moves the gateway forward on them:
  `hono` 4.12.8 to 4.12.10, `@hono/node-server` 1.19.11 to 1.19.12, `express-rate-limit` 8.3.1
  to 8.3.2, `path-to-regexp` 8.3.0 to 8.4.2, `zod-to-json-schema` 3.25.1 to 3.25.2. Those ship
  with the first gateway deploy after the wiring PR and are proven by that deploy's test run.
  `zod` is pinned at 4.3.6 as a direct dependency of each plugin, as rehearsed. What still
  differs from each plugin's old lockfile, all forward: `ajv` 8.18.0 to 8.20.0 in both, and in
  `gws-mcp` `jose` 6.2.1 to 6.2.2 plus the five above. So the production package list of a
  plugin is **not** identical to its old one, by ruling; it is identical in package names and
  count (91 each), and differs in those versions only.
- **A fresh checkout's `pnpm -r test` is red.** The `gws-mcp` oracle test fails, by design
  never skips, when the pinned CLI binary is absent, and the binary is a gitignored download.
  Until step 11 drops the CLI, the plugin's `test` task depends on `download-binaries`. After
  it, the oracle's expected requests are fixtures in the repo and nothing is downloaded. As
  built at step 7: the `test` script fetches only the one binary for the machine it runs on,
  and every archive is checked against a pinned sha256 before it is unpacked.

**What the gateway and the plugins share.**

| Shared by copy today | After the move |
|---|---|
| The file-crossing wire contract: two private route paths, the token header, the arguments header, the `{error, code}` answer, the byte cap. Three copies | **`packages/plugin-contract`**: constants and types only, built to `dist/` like its siblings. The one package that falls out. A follow-up PR, because it changes plugin code |
| Tool names: plugin tool arrays against the gateway's classification, snapshot and runner cases | No package. CI saves each plugin's `tools/list` (section 5), and a gateway test compares against that file |
| Google scope list, in the gateway and twice in `gws-mcp` | A test across the tree, not a package |
| Response helpers, annotation presets | Left alone. Each plugin has its own and they are not copies |

## 4. Deploy: the plugins ship inside the gateway image

### The options, and the ruling

| | A. Folder in the gateway's volume (revisions 1 and 2) | **B. Inside the gateway image (ruled, revision 6)** | C. Own container, own image (revisions 3 to 5) |
|---|---|---|---|
| Rollback id | Per surface | One for everything | Per surface: an image digest |
| A plugin change restarts the gateway | Yes | Yes | No |
| Built where | On the host, in a one-off container | By GitHub, as part of the gateway image | By GitHub, one image per plugin |
| New machinery | Release directories, a symlink, a release script, a build container | A few lines in one `Dockerfile` and one value the gateway reads | Two compose services, one `Dockerfile`, a network decision |
| Plugin sees the gateway's secrets | Yes, inherited | **No, by a rule in code** (below, with its limit) | No, by the container boundary |
| Memory accounting | Inside the gateway's limit | Inside the gateway's limit | Its own limit |
| A crashing plugin | Restarted by the gateway, today without a limit (section 2) | Same, with the limit made real (below) | Restarted alone by Docker |

**SCRUM-393 stays absorbed, by the ruling.** It asked for restarting one plugin without
restarting the gateway. Its reason was plugin releases. Under B there is no plugin release
apart from a gateway deploy, so there is no plugin restart to do alone. What this does **not**
deliver, said plainly: the capability itself. A plugin-only change still restarts the gateway
and drops every session, and a plugin that cannot stay up is never restarted by anything but
the gateway that started it.

**The record of option C**, for the day a plugin is moved out. One multi-stage
`plugins/Dockerfile` taking the plugin as a build argument: install from the root lockfile,
compile, `pnpm deploy --prod`, a final stage on the slim Node image as a non-root user.
Rehearsed on a laptop, at idle only:

| Measured | `gws-mcp` | `atlassian-mcp` |
|---|---|---|
| Build | 8 s, dependency store warm | 15 s, built first and so including the download |
| Image size | 237 MB | 236 MB (the Node base image is most of it) |
| Tools served from the image | 68 | 24 |
| Memory at idle, as the container runtime counts it | 28 MiB | 23 MiB |

Both ran with a 256 MB limit, a read-only root filesystem, every capability dropped, and as
uid 1000; one plugin container restarted and answered again in about six seconds while the
other was untouched. No tool call with a real token ran. Two things from that rehearsal carry
into B: both plugins build and serve from the root lockfile, and both start as a non-root user.

### The image (proposed)

The gateway's `Dockerfile` keeps its three stages and gains the plugins in each:

| Stage | Today | Added |
|---|---|---|
| `base` | The workspace's manifests | Each plugin's `package.json`, so the frozen install sees every importer in the lockfile |
| `build` | Installs everything, builds the packages and the gateway | Copies `plugins/`, builds each plugin (`tsc` into `server/`) |
| `runtime` | Production dependencies, the build's output | The production install now covers the plugins too. From the build stage: each plugin's `server/`. From the tree: its `package.json`, `datatorag.json` and `README.md` |

The result is `/app/plugins/<slug>` holding what a checkout in the volume holds today, minus
the source, the git metadata and the dev dependencies: the manager reads `package.json` to find
the entry point and runs `node server/index.js` from that directory, exactly as now.

**Not at the path the volume is mounted on.** The volume sits on the home directory's plugins
folder, and a mounted volume hides whatever the image has at that path. So the image's plugins
live at `/app/plugins`, beside the gateway, and the volume keeps its place until close-out.

Unmeasured, and step 8 records them: how much the image grows (the plugins' production
dependencies), how much longer it takes to build, and whether the frozen production install
resolves the plugins the way the rehearsed plugin image did. That rehearsal used `pnpm deploy`
into a separate directory; this layout installs them in place in the workspace, which nothing
has run.

**The commit.** A plugin in the image has no commit of its own. It was built from the tree of
the gateway's commit, and the image already carries that as `GATEWAY_SHA`.

### Where the gateway loads a plugin from (proposed)

One value, `DATATORAG_PLUGINS_DIR`. The manager uses it when set and falls back to today's
directory under the home folder when it is not, which is what a laptop and every older image
do. **It is set in the `Dockerfile`, not in the compose file and not in the parameter store.**
That is the point of refusal 9:

- The cutover is one image. The image that sets the value loads from `/app/plugins`; the image
  before it does not have the value and loads from the volume, where the checkouts still are.
- So the pipeline's rollback is the whole undo. No compose edit, no host file, no database row
  and no second step that someone has to remember under pressure.
- The copy of the compose file on the host does not change at the cutover, so the release
  workflow's checksum stop has nothing to object to.

`startAll()` is otherwise unchanged: it still reads the active rows, still starts each plugin
on the port its row holds, and still skips a slug whose directory is missing.

### A plugin's environment (proposed, and where it stops)

Today `spawnPlugin` hands the child the gateway's whole environment. The ruling: a plugin is
started with only its own variables, never the gateway's keys.

| The child gets | Why |
|---|---|
| `PATH` | To find `node` |
| `NODE_ENV` | The plugins and their dependencies read it |
| `PORT` | From the registry row, as today |
| That plugin's rows in `mcp_server_env_vars`, as literal values | The existing per-plugin mechanism, without its `$NAME` form (below) |
| Nothing else | The database URL, the OAuth client secrets, the provider keys and the session material stay in the gateway |

Six things this has to get right:

- **The `$NAME` form is removed. Ruled.** A row whose value starts with `$` copies a named
  variable out of the gateway's environment. That was harmless when the child had everything
  anyway. After scoping it would be the one way a gateway key could still reach a plugin, by a
  database row. It is deleted, with no allow-list in its place: a row's value is passed as it
  is written, and a value that starts with `$` is refused with a log line and left out, so an
  old row cannot turn into a literal by accident. Step 3's precondition is that no row uses
  the form; that is checked against production before the deploy and reported privately.
- **No plugin is given an OAuth client id or secret, by a row or by a prefix in the gateway's
  environment.** Neither needs one. The gateway holds the client credentials for each
  provider, does the code exchange (`auth.ts`) and every refresh (`service-token.ts`) itself, and hands a
  plugin only the access token of the user whose call it is serving, in a header on that one
  call. That is how it works today and step 3 does not change it; it is written down here
  because scoping the environment is the moment someone would otherwise go looking for where
  the credentials went. If a future plugin does need a secret of its own, it gets a row with a
  literal value, which is a deliberate act with a name on it, and never a share of the
  gateway's.
- **`gws-mcp` reads three names besides `PORT`,** all in its CLI client: two for an OAuth
  client and one for a config directory. They are used only when it starts the `gws` CLI, to
  which it also hands its whole environment. The hosted path never starts the CLI: a call
  arrives with a user's token and goes to the provider's API directly. The gateway's own
  environment uses different names for its Google client, so the plugin does not get those
  two today either, and nothing changes for it. Without a config directory named, it derives
  one under its user's home and does not create it unless the CLI runs. There is a fourth
  source for the client pair: a file named `oauth.json` beside the compiled code, which only
  the desktop bundle's build script writes and which git ignores. It must not be in the
  image, and step 8 checks that it is not. Step 3's test run verifies the rest instead of
  assuming it. Step 11 removes the CLI path and the bundle with it.
- **A row cannot set the names the manager sets, or the ones that change how the child
  runs.** Row keys are unconstrained today, and a row can even replace `PORT`. With step 3 a
  row whose key is `PORT`, `PATH`, `NODE_ENV`, `NODE_OPTIONS` or starts with `LD_` is refused
  the same way as a `$` value. This is tidiness, not a boundary: whoever can write that table
  can already change what the gateway does.
- **The dead install path still hands a build the gateway's whole environment.** Nothing calls
  it (section 2), and after the cutover nothing could use it. "Never the gateway's keys"
  depends on it staying uncalled until it is removed, which is listed in section 9 as not
  addressed here.
- **A known-bad case pins it.** The test sets a marker variable in the parent and fails if the
  child can see it, so restoring the spread turns the test red.

**Where this stops.** Scoping the environment protects against the ordinary ways a key leaks:
a plugin or one of its dependencies logging or sending its environment, an error report that
includes it, a child the plugin starts inheriting it. It does **not** stop a plugin that has
been taken over, if that plugin runs as the same user as the gateway in the same container: on
Linux a process can read the environment of another process of the same user from `/proc`, and
can read whatever files that user can. The gateway runs as root in its container, and so do
its children today.

**Ruled in: each plugin runs as a non-root user.** The manager passes a user and
group id when it starts the child (the Node image ships an unprivileged `node` user). A
non-root process cannot read a root process's environment or memory, and cannot write the
gateway's files as long as those stay owned by root. Both plugins have already run as uid 1000
(the option C rehearsal, idle only). Three things about it:

- **It cannot ship with step 3.** Until the cutover the plugins load from a folder under
  root's home, which a non-root user normally cannot enter. So it is a deploy of its own after
  step 10, when the plugins are under `/app/plugins`.
- **One user per plugin, not one for both.** Two processes of the same user can read each
  other's environment the same way. With a user each, "only its own variables" also holds
  between the plugins.
- **Unknown:** whether either plugin writes anywhere at run time other than a temp directory.
  A test run that exercises every tool would show it.

It is one option on the spawn call, but it is a second behaviour change, so it is step 10b: a
deploy of its own after the cutover, with its own go.

**What neither does.** A plugin child still shares the gateway's network. It can reach the
gateway on loopback and any address the gateway can. That is today's state, it is our own
code, and it is what option C would have changed. The next section is the record of that.

### Compose

Back to what is on the host today. No service is added.

| Service | File | Image | Network | Published | Volume |
|---|---|---|---|---|---|
| `gateway` | `docker/docker-compose.prod.yml` | `${GATEWAY_IMAGE}`, by digest, set by the host script | `datatorag-mcp-network` | Port 80 | `plugins-data` on the home directory's plugins folder, until close-out |
| `canary` | `docker/canary/compose.host.yml` | `${CANARY_IMAGE}`, by digest | The same network, as an external one | Nothing | None |

The gateway's compose file changes once in this work, at close-out, when the volume line comes
out (step 12). This work does not change its memory limit, which keeps covering both plugin
processes, as it does today. (The limit itself was raised from 3072 MB to 6144 MB by a separate
change, SCRUM-411.)

### The shared network: what a plugin container can reach

**Ruled A, 2026-10-09: accepted as it is.** The reason given: with the plugins staying
inside the gateway container, the only other container on the shared network is the canary,
which sends nothing. Options B to E stay below as the record for the day a plugin is moved
out. None of them is scheduled.

**How to read the rest of this section.** It is revision 5's text, written when two plugin
containers were about to join the network, and it is unchanged except for this opening and the
closing paragraph. It describes a design that is not being built. Its "step 5" and "step 9" are
revision 5's steps (the import, and the plugin containers' first start on the host), and "the
move" in it means that move into containers.

**What A leaves in place**, so the acceptance covers it knowingly:

- The canary can reach the gateway's port without passing the edge, and could send the header
  described below. It is our own image, read-only, with every capability dropped, and it sends
  nothing.
- **A plugin process inside the gateway's container can do the same over loopback.** That is
  not about the shared network and is not changed by this work: it was true before the question
  was asked and stays true. It is our own code, and it does not get past authentication. The
  ruling's reason is about containers, so this is said here and not left to be found. Option B
  is the fix for both, if it is ever wanted.
- **The canary can reach the plugins' ports too.** Both plugins listen on every interface of
  the gateway's container, so their ports answer on the shared network, today and after this
  work. A call there is useless without a user's token, and the private file routes refuse a
  tokenless request (rehearsed: 401). Binding the plugins to loopback would close it; that is a
  plugin change and is not proposed here.
- Nothing here was probed from a live container. The rows about the host's own ports and the
  metadata address are still unverified.

**The question as it was asked.** Revision 4 said the network is the boundary and that a
service joining it should be a deliberate act. That was written when nothing but the gateway
was on it. Two things had changed: a canary container is on it, and the spec was about to add
two containers that run third-party-facing code with user tokens passing through them. A plugin
is the least trusted code we run. This is what joining the network gives it, what it needs, and
what was proposed.

**What a container on `datatorag-mcp-network` can reach today.** Read from the compose files
and the code, not probed from a live container (the probe is step 9's job, listed below).

| It can reach | How | Why that matters |
|---|---|---|
| The gateway's port 80, directly | By service name on the network. The gateway listens on every interface of its container | The request does not pass the edge. See "the header" below |
| Every other container on the network, on any port it listens on | The network is one flat bridge; nothing on it filters between members | After step 9 that is the other plugin's `/mcp` and its private file routes |
| The internet | A bridge network has outbound access by default | A plugin needs this: its whole job is calling its provider's API |
| The host's own addresses on that bridge | The bridge's gateway address is the host | Anything the host listens on at every address may be reachable from a container. A firewall written for traffic arriving from outside does not by itself cover traffic arriving from a bridge. Which ports actually answer is unverified; step 9's probe reads it |
| The cloud provider's instance metadata address | It is link-local and routed from containers unless something blocks it | Whether anything of value is served there depends on the instance; to be read at step 9, not assumed |

**What it cannot get.** A session on the database: the database is not on the host and a
container with outbound access can reach its endpoint, but the connection string is in the
gateway's environment, not on the network. Another user's provider token: the gateway resolves
a token per call and sends it in a header on that one call's requests, so a plugin holds only
the tokens of calls it is serving. The gateway's own process environment and the plugin volume
of another container: those are not network resources.

That last point is true only AFTER the move. Today a plugin is a child process inside the
gateway's container: it is started with the gateway's whole environment and can reach the
gateway on loopback. So the baseline this section compares with is weaker than the table
suggests, and moving the plugins into their own containers removes exposure. This section is
about what is left once they have moved.

**The header.** The gateway decides a client's address from a header the edge sets. Two
functions do it. The one in front of the OAuth endpoints (`oauth/rate-limit.ts`) falls back to
the connection's peer when the header is absent. The lead form's (`api/leads/route.ts`) never
looks at the peer: after the edge's header it takes a forwarded-for header, then another
header, then a fixed placeholder. Trusting the edge's header is sound for traffic from outside:
the host's firewall admits port 80 only from the edge, and the edge overwrites the header. It
is not sound for a request that starts on the shared network. Such a request never passes the
edge, so it can carry any value in that header, and the gateway believes it. With it, a
container on the network can:

- get around the per-address limit on the OAuth endpoints by naming a new address per request,
  or spend a real address's allowance by naming that address;
- file lead-form entries under any address it likes, past whatever is keyed on the address;
- reach every public route of the gateway without passing the edge, so without whatever the
  edge filters or limits (the edge's configuration is not in this repository).

It cannot skip authentication with this: a bearer or a session is still checked. What it
defeats is the address-based limits, and those are what stand in front of the unauthenticated
OAuth endpoints. Today the only other container on the network is the canary, which sends
nothing. After step 9 it is each plugin.

**What a plugin container needs.**

| Direction | Needed | Not needed |
|---|---|---|
| In | Requests from the gateway to its one port | Requests from the other plugin, the canary, or anything else |
| Out | Its provider's API over HTTPS, and DNS | The gateway, the other plugin, the host's own ports, the metadata address |

Nothing a plugin does starts a request to the gateway, as far as the gateway's side shows: it
has no route meant for a plugin, and it is the gateway that calls the plugin, in both the tool
path and the file crossing. The plugins' own sources are not in this repository until step 5;
the claim is to be confirmed against them then.

**Options.**

| | What it is | Cost | What it leaves |
|---|---|---|---|
| A | Leave the one network as it is and accept it | None | Everything in the first table |
| B | **The gateway believes the header only from a peer that is the edge.** The header counts when the connection's peer is in the edge's published address ranges; from any other peer (a neighbour on a container network, the host itself, loopback) it is ignored and the peer is the client. One shared function in place of the two that decide this today | A gateway change with tests, larger than it looks in one place: the lead form runs where the connection's peer is not available, so the server has to hand the peer to it in a value the server itself sets, or that limit moves to where the peer is. **It can cause an outage if a fact is wrong**, so the fact is checked on the host first, for both address families: that for traffic through the published port the gateway sees the edge's address as its peer and not the bridge's. If it sees the bridge's, every real client lands in one bucket and the OAuth endpoints refuse almost everyone. The edge's ranges change now and then, so the list needs an owner | A plugin can still reach the gateway's routes and the other plugin's port, but as itself: one address, limited like any client |
| C | **One network per plugin.** Each plugin gets its own network; the gateway joins all of them; a plugin joins only its own. The canary moves to its own network too | Compose only. The gateway reaches each plugin by the same service name as before | A plugin can no longer reach the other plugin or the canary. It can still reach the gateway, which is on its network by design |
| D | Host firewall rules for container traffic: drop from the plugin networks to the host's own ports and to the metadata address | Host rules, kept by a person, in the chain the container runtime reserves for them. One more thing installed on the host and one more thing to drift | Closes the last two rows of the first table. Does not replace B or C |
| E | An outbound allow-list per plugin (only its provider's hosts) | A forward proxy or per-container rules by address; provider address ranges move | The strongest answer to "a compromised plugin sends tokens somewhere else", and the most machinery |

**Recommendation: B and C before step 9, D at step 9, E not now.**

- **B** is the one that fixes something already true today, and it is cheap. It should ship on
  its own, through the gateway's normal deploy, before any plugin container exists. Until it
  does, the canary is the only neighbour and it is inert, so there is no urgency beyond that.
- **C** costs a few lines of compose and takes away plugin-to-plugin reach, which nothing
  needs. A plugin could still come back at the gateway through the host's published port, which
  is why C goes with B and not instead of it. It changes section 4's compose table (the "Network" row) and nothing else in this
  spec: discovery by service name, the ports and the health checks are the same.
- **D** belongs with step 9, when the plugin containers first start on the host with no
  traffic. That step should also do the probe this section did not: from inside a plugin
  container, list what answers (the gateway, the other plugin, the host's ports, the metadata
  address). The result goes in the private report for that step, never into this file: what
  answers on a host is evidence, and this repository holds the rule.
- **E** is the right shape eventually and the wrong size now. With B, C and D in place, what a
  compromised plugin can still do is use the tokens of the calls it is serving against its own
  provider, and send them out. An allow-list stops the second half only. It is worth its own
  ticket once the containers have run for a while and their real outbound hosts are known.

**Not proposed: making the gateway unreachable from the plugins' networks.** Nothing on those
networks needs to reach the gateway, but the gateway must reach the plugins, and on a bridge
network reach goes both ways. Putting a proxy between them to make it one-way is more
machinery than B, which makes the gateway safe to be reached.

**What the ruling changed in this spec.** A was ruled, so this section stays as the record of
what was accepted. No step was added for B, C or D, and the compose table is back to the
gateway and the canary.

### How a test run learns a plugin's commit

Today `plugin-sha.ts` reads `<slug>/.git/HEAD` under the plugins directory. A plugin in the
image has no git metadata. Proposed: when the plugins directory is the image's, the recorded
sha for every plugin is the gateway's own commit, `GATEWAY_SHA`, which is true by construction.
The git reader stays for a local checkout and for an older image running from the volume. A
run then shows the cutover as each plugin's sha changing from its old repo's sha to the
gateway's.

### When a plugin process is down

Unchanged from today, and said here so nobody reads more into the move than it gives.

| Situation | Behaviour (read) |
|---|---|
| `tools/list` | Served from the registry; the tools stay listed |
| A call while the plugin's port is closed | Throws `fetch failed`; the caller gets that raw text |
| A plugin exits unexpectedly | The gateway starts it again at once |
| A plugin that keeps crashing | Restarted without end and without a pause: the three-in-sixty-seconds limit in the code is never reached (section 2). Log lines and nothing else |
| Gateway boot with a plugin directory missing | Skipped with a warning; the gateway serves everything else |

**The restart limit is made real, and a plugin that hits it shows on `/health`. Ruled.**
Revision 5 ruled a restart-loop alert, designed for containers the gateway could not see. Here
the gateway can see, because the manager is the code that restarts a plugin. With step 3:

- **The limit.** The crash count is kept across restarts, which means fixing both things that
  lose it today: the entry that holds the count is deleted before the restart, and the new
  crash time is added to a copy. The rule is the one the code's condition already states:
  three restarts inside sixty seconds, and the fourth crash in that window is not restarted.
  The log line that says "three times" is corrected to match.
- **The behaviour change.** Today a crashing plugin is retried forever. After this, one that
  keeps crashing inside a minute stays down until the gateway restarts. Its tools stay listed
  and its calls fail with the raw error, as in the table above.
- **Where it shows.** `/health` gains one field: each active plugin's slug with `up` or
  `down`, where `down` means the manager has stopped restarting it. No new alert path: the
  existing daily check that reads `/health` reads this field too.
- **The status code does not change.** `/health` answers 200 with `status: ok` whether or not
  a plugin is down. The container's health check and the deploy's health wait both read only
  whether the answer is ok. If a down plugin turned that red, a plugin that cannot start would
  make the gateway itself look dead, and the deploy would put the old image back for a fault
  that a put-back may not cure. A person reading the field decides.
- **A known-bad case pins the limit:** a plugin made to exit at once is restarted exactly
  three times and then reported `down`; with the count lost again, the test does not end.

The retry and the worded errors of revision 5 are dropped: they covered the seconds a plugin
container was being replaced on its own, which no longer happens.

### What a plugin change becomes

A gateway change. A merge that touches `plugins/<slug>/**` builds the gateway image for that
commit. A dispatch of `release.yml` names the surface `gateway` and the sha, the production
environment holds it for approval, and the host starts that image by digest. Rollback is the
same dispatch with the rollback flag, and it takes the plugins back with it.

What the image cannot say is whether the **registry** agrees with it. So a deploy whose range
touched `plugins/` owes the ground-truth check afterwards, from inside the gateway container
where the database and the plugin ports both are: the registry must list exactly the tools each
plugin now serves. A difference is repaired by a registry write, which is a person's, and rolls
nothing back. The check compares names; a changed description or schema is what `registry:diff`
is for. The release job cannot run this check (it sends the host one request line and
reads the answer). Ruled: it runs in the existing post-deploy routine, not in new pipeline code.

**The record.** A deploy row names the surface `gateway`, the sha and the image digest, as
SCRUM-394 already has it. There is no `plugin:<slug>` surface. A registry change keeps its own
row.

### What goes away

| Gone | Why it existed |
|---|---|
| The checkout in the volume, compiling inside the production container, and the "was it actually rebuilt" check | The plugin was built where it ran |
| A plugin release as its own procedure: pull, install, compile, restart | Same |
| The `plugins-data` volume | Removed from the compose file at close-out |
| `git`, `curl`, `unzip` and `pnpm` in the running image | They are there for in-place plugin updates. Removing them is a later change of its own, after close-out |
| Revision 2's release directories and revision 3's plugin images, compose services and URL override | Each gave a plugin its own rollback id, which the ruling does not want |

`plugin-manager`'s spawn path is the production path again, and the local one: on a laptop a
plugin is still a checkout the gateway starts.

## 5. Registry

**Today.** A plugin change that alters a tool's description, schema or existence needs a
change file: one guarded statement per row (the guard is the md5 of the description and of
`input_schema_json::text` as the old build produces them), a row-count assertion,
`updated_at = now()`, and a rollback file. It is generated from two builds of the plugin repo
by a script kept in none of the repos.

**After.** When CI builds the gateway image it starts each plugin from that image, asks it for
`tools/list` (the served list, not the source array: a plugin can withhold a tool it defines),
and keeps the answers as `tools-<slug>.json` beside the image's digest record. Then one command
in this repo:

```
pnpm registry:diff <slug> --from <sha> --to <sha>     # writes forward.sql and rollback.sql
```

It compares the two shas' tool files, fetched from CI and from nowhere else, and emits the same
guarded statements used today, headed NOT RUN. It never opens a database connection. `--from`
is the sha of the gateway that is running.

As built at step 8: the tool file holds, per tool, the name, description, input schema and
read-only hint, sorted by name. It sits in the same build record as the image's digest, and
the command takes it only from a record that a deploy would believe: a build run on a commit
that is on main, from this repository, naming the digest the registry still holds for that
commit. Records that pass must agree, or nothing is generated. The statements sit in a
dollar-quoted block whose tag is a name, and a tool whose text contains that tag is refused,
so nothing a plugin serves can end the block. A statement is also guarded by the old
read-only hint, and each file asserts the plugin's row count afterwards. Both commits must
have been built after tool files were kept, so the first change it can generate is between
two images from step 8 onward.

The generator has one hard part and it gets a self-test: the guard must reproduce Postgres's
`jsonb::text` rendering exactly, or every guard misses and the file safely does nothing.
Fixtures are public tool schemas with their known md5s.

**The order of a tool change, which this ruling changes.** Today a new tool goes plugin, then
the registry row, then the gateway that classifies it: three steps, because the plugin and the
gateway ship separately. In one image they arrive together.

| Change | Proposed order | What a user sees in between |
|---|---|---|
| A new tool | The deploy, then the INSERT | Nothing: a tool without a row is not listed |
| A removed tool | The DELETE, then the deploy | Nothing: the tool stops being listed while it still works |
| A changed description or schema | The deploy, then the UPDATE | The old text for the new behaviour, for as long as the gap lasts. Same as today |

Two cautions. The order is ruled as proposed and is first proven at step 11; nothing has exercised it yet. And the gateway has a classification test for a
new tool that is gated on a live registry and is red until the row exists; with the INSERT now
after the deploy, what that test should expect in between is settled in the wiring PR (step
7), not discovered at the first new tool.

**The drift gate and where a tool comes from.**

| Place | Assumption | After |
|---|---|---|
| `registry-ground-truth.test.ts` | Slug to URL from `PLUGIN_MCP_URLS`; no repo assumption | Unchanged. The variable stays a test input, set by whoever runs the check to the plugins' loopback addresses. Its blind spot stays: names only |
| `tests/plugin-sha.ts` | A plugin directory is a git checkout | The gateway's commit when the directory is the image's (section 4) |
| `/tools/[slug]` page | README from the plugin's directory on the gateway's disk, else GitHub's README for the repo in the registry row | Ruled: one README per plugin, from the tree the image is built from. The GitHub fallback is removed, so a page never shows an archived repo's text |
| `mcp_servers` repo columns | One repo per plugin; non-null means "runs locally" | Left as they are. "Runs locally" is true again, and the tool pages keep their source link |
| Skills (`deploy`, `ops-debugging`, `gws-mcp-dev`, `codebase-map`) | Separate repos, checkout in the volume, a plugin update procedure | Rewritten in the PRs that change each fact (freshness rule) |
| Ops scripts kept outside this repo | They assume a checkout in the volume to inspect | Swept at the cutover; listed in the report, not here |

## 6. Gates

One range, one script: `scripts/gate.sh [base]`. SCRUM-394 built the workflow that runs it on
every pull request, the protection on `main`, and what a green check does and does not mean.
This spec owns the plugin rows of the path table.

| Changed path | Surface | Runs | Image built on merge |
|---|---|---|---|
| `plugins/<slug>/**` | `gateway` | That plugin's build and tests, and the gateway's | The gateway's |
| `apps/gateway/**` (content included), `packages/**`, `docker/**` | `gateway` | Gateway tests, typecheck | The gateway's |
| `pnpm-lock.yaml`, root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json` | every surface | Everything | All |
| `docs/**`, `.claude/**` | none | Nothing | None |

`plugins/**` also joins the list of paths that make a pull request build the image without
publishing it, so a plugin change that breaks the image is seen before the merge.

Always, on the whole range and never filtered: the ancestry check, the security reviewer, the
leak scan. A path filter decides what is built and tested. It never describes what a deploy
does: a gateway deploy restarts the gateway, whatever the diff was.

## 7. Migration

Order: the pipeline first (done), then the plugins' environment, then the source moves, then
the plugins are loaded from the image. The step numbers below are revision 6's. The
shared-network section in section 4 cites revision 5's numbers and says so.

**Phase 0: before the import.**

| # | Step | Verification | Rollback |
|---|---|---|---|
| 1 | **CI gate and repository settings.** Done (SCRUM-394) | | |
| 2 | **The pipeline, proven on a canary, then the gateway through it.** Done (SCRUM-394) | | |
| 3 | **Done (2026-10-09).** **The plugins' environment and the restart limit, one PR and one gateway deploy, its own go.** `spawnPlugin` passes the short list of section 4 and nothing else. The `$NAME` form is removed. The restart limit is made real and `/health` reports each plugin `up` or `down`. No plugin gets an OAuth client credential, before or after | Its tests, with three known-bad cases: a marker in the parent must not reach the child; a row value starting with `$`, and a row with a reserved key, are refused; a plugin that exits at once is restarted three times and then reported `down`. Before the deploy: no production row uses the `$` form. After it: each plugin child's environment holds only the expected **names** (names only, in the private report); `/health` is 200 and reports both plugins `up`. The test run diffs to zero regressions against a baseline taken just before. One live read per plugin | The pipeline's rollback |

Step 3 comes before the import on purpose. It changes how today's plugins are started and
nothing about where they come from, so if a tool breaks, the cause is the environment and not
the move.

**Phase 1: the source moves. Nothing deploys.**

| # | Step | Verification | Rollback |
|---|---|---|---|
| 4 | **Done (2026-10-09).** **Freeze the plugin repos.** Record both `main` tips. Lock `main` on each. Tips: `gws-mcp` `64a9b9d`, `atlassian-mcp` `c3fd27d` | A push to `main` is refused | Remove the rule |
| 5 | **Done (2026-10-09).** **Import PR**, two commits and nothing else (commands below), merged as a merge commit | `git rev-parse HEAD:plugins/<slug>` equals `<tip>^{tree}` in the plugin repo, for both. The old shas resolve. Commit count is the three counts plus two. Leak scan and security gate over the whole range. `git status` clean | Do not merge; after merge, revert the two commits. `plugins/` is inert: not in the workspace, not in any image |
| 6 | **Done (2026-10-09): nothing was kept to port** (the branch table below). **Port what is kept**: `git format-patch` in the old repo, `git am --directory=plugins/<slug>` here | The ported branch's `plugins/<slug>` tree equals the source branch's tree | Delete the branch |
| 7 | **Done (2026-10-09).** **Wiring PR**: workspace glob, package names, `files`, lockfiles, the pins, `turbo.json`, plugin rows in `gate.sh`, the skills, each plugin's `CLAUDE.md`, and the sweep of standalone-server copy. The image does not carry the plugins yet | Frozen install is clean. Test totals per plugin equal the pre-move totals at the same source. Gateway suite, typecheck and build unchanged. The production package list of each plugin equals the one its old lockfile gives. The gateway image builds, and is deployed as an ordinary gateway deploy only when something else needs one | Revert the PR |

**Phase 2: the plugins are loaded from the image.**

| # | Step | Verification | Rollback |
|---|---|---|---|
| 8 | **Done (2026-10-09).** **Image PR, inert.** The `Dockerfile` builds both plugins into `/app/plugins`. CI keeps each plugin's tool file. `registry:diff`. The manager learns `DATATORAG_PLUGINS_DIR` and the commit rule, but the image does **not** set the value, so the gateway still loads from the volume. Deployed through the pipeline | Each tool file equals, tool for tool (name, description, schema, read-only hint), what the plugin repo's own build serves at the frozen tip. The image holds no `oauth.json` under either plugin. Image size and build time recorded against the image before. After the deploy a test run is unchanged and still records both plugin shas from the checkouts | The pipeline's rollback |
| 9 | **Done (2026-10-09).** **Side by side in the running container, its own go.** A host step. Each plugin's copy in the image is started by hand on a spare port, with the scoped environment and no traffic, compared, and stopped | Its tool list equals the **running** plugin's, tool for tool. Its private file route refuses a tokenless call. The spare port does not answer from outside the host (it does answer on the shared network, like the plugins' own ports) | Stop the process. Nothing else was touched |
| 10 | **Done (2026-10-09).** **Cutover, its own go.** One PR sets `DATATORAG_PLUGINS_DIR` in the `Dockerfile`; that commit is deployed. Both plugins move in this one deploy | Baseline test run before, post run after, zero regressions. Each recorded plugin sha is now the gateway's commit. Each plugin child's working directory is under `/app/plugins`. One Gmail read, one Jira read, and one email filed on a Jira issue end to end. Then the **rollback drill** (ruled in, run in a window named when the go is given): the pipeline's rollback to the image before, the plugins load from the volume again and the same three calls work, then forward again | The pipeline's rollback. The checkouts are still in the volume |
| 10b | **Done (2026-10-09).** **Each plugin as its own non-root user, its own PR, deploy and go.** After the cutover, because until then the plugins load from under root's home | Its test, with a known-bad case (a child started as root fails it). After the deploy: each plugin process runs as its own user and neither is root; a full test run diffs to zero regressions, which is also what shows whether a plugin writes somewhere it now cannot; `/health` reports both `up` | The pipeline's rollback |
| 11 | **Done (2026-10-09).** **First plugin change through the pipeline, its own go: the service-plugin cleanup of `gws-mcp`.** The `.mcpb` bundle, the stdio entry point, the CLI fallback and its download go; the oracle's expected requests become fixtures | `registry:diff` between the two tool files says exactly which tools changed, and if any did, the change file exists before the deploy and is run by a person in the order section 5 gives, which this step is the first proof of. The ground-truth check passes | The pipeline's rollback, and the change file's rollback if one ran |
| 12 | **Done (2026-10-10).** **Close out.** Remove the volume from the compose file, which also means replacing the copy on the host (a host step). Old repos: a final README commit naming the new home, open issue transferred, then **archived**. The pins come out later as their own change | Not before the image the pipeline would roll back to also loads from the image; otherwise a rollback lands on a gateway with no plugins. The archived repos refuse a push. A fresh clone builds and tests both plugins. The gateway restarts cleanly with no volume | Unarchive; the volume's data is kept for a stated period before deletion |

**Does each step prove one new thing?** Steps 4 to 9 and 10b do. Step 3 carries two changes to how a plugin is started (its environment and the restart limit) in one deploy, by ruling; they are told apart by their separate known-bad tests, and a plugin that never crashes never meets the second. Step 10 does not: at the cutover a
plugin changes both where it is loaded from (the volume to the image) and what it was built
from (the plugin repo to this one), and both plugins change at once. The two are separated by
evidence instead: step 7 holds the dependency list fixed, step 8 holds the served tools equal to
the old build's, and step 9 holds them equal to what is running, all before a single call
moves. What is lost against revision 5 is cutting one plugin over before the other. One image
cannot do that without a per-plugin switch, and a switch is machinery the ruling set aside.

**What the drill costs.** Every row above that deploys is a gateway restart, a few seconds in
which calls fail and after which every MCP session starts again. Step 10 is three restarts,
with the drill. The drill would also be the first time the gateway's pipeline rollback is
exercised at all, which is its own reason to do it.

**The freeze window.** From step 4 to step 10, a plugin change cannot ship the ordinary way:
the old repo is locked and the image's plugins are not serving. That window should be days. The
emergency path is the old one: unlock, commit there, roll out as today, and port the commit. A
plugin change already in flight (`gws-mcp` has one today) ships before step 4 or is ported in
step 6 and waits.

```bash
# Step 5. Run from a branch off main; <tip> is the frozen main sha of each plugin repo.
git subtree add --prefix=plugins/gws-mcp       https://github.com/datatorag/gws-mcp.git       <tip>
git subtree add --prefix=plugins/atlassian-mcp https://github.com/datatorag/atlassian-mcp.git <tip>
```

No `--squash`. Rehearsed at the tips named at the top: both directories byte-equal to their
sources, every original sha present, `git blame` attributes lines to the original commits.

**What history looks like afterwards** (rehearsed, and the cost of refusal 3): `git log --
plugins/gws-mcp/src/tools/gmail.ts` shows only the import commit, and `--follow` shows nothing.
The file's real history needs `git log --full-history -- src/tools/gmail.ts
plugins/gws-mcp/src/tools/gmail.ts`, or `git log <old-tip> -- src/tools/gmail.ts`. This goes in
the plugin skill.

**Branches on the old repos** not merged into `main` as of 2026-10-06, from `git ls-remote`.
Re-read at step 4 on 2026-10-09: the same four branches were the only ones ahead of `main`, on both repos.

| Repo | Branch | Ruling |
|---|---|---|
| `gws-mcp` | `scrum-392-sheets-coercion-sentence` | Shipped before step 4; it is in the frozen tip |
| `gws-mcp` | `feature/chore/gws-cli-0.22.5` | **Dropped at step 6 (ruled 2026-10-09).** Its local commits were pushed to the branch first. It does not apply to the frozen tip without a choice in the CLI download script, its own notes hold it, and step 11 deletes the CLI path it bumps. Readable in the archive |
| `gws-mcp` | `scrum-278-gmail-signature` | Drop. Readable in the archive |
| `atlassian-mcp` | `feature/fix/jira-search-response-shape` | Drop. Its fix is already on `main` |

Local-only branches and a stash exist on the development machine; an import cannot see them.

**Local development after the move.** A laptop's plugin directory is a clone today. It becomes
a link from `~/.datatorag/plugins/<slug>` to `plugins/<slug>` in one checkout, built in place
and spawned by the gateway as now.

## 8. Other work this touches

| Work | Effect on this spec |
|---|---|
| The gateway's deploy pipeline (SCRUM-394) | Built. This spec adds no surface to it |
| SCRUM-384, the file crossing | The prose form of the contract `packages/plugin-contract` encodes |
| Notion connector (SCRUM-366), a design and a plan on its branch | Born at `plugins/notion-mcp`: a directory, a registry row and its lines in the gateway's `Dockerfile`. Its plan's step creating a plugin repo becomes a directory |

## 9. Risks

| Risk | Likelihood | What holds it down |
|---|---|---|
| The plugins in the image differ from what runs because dependencies re-resolved | Seen in rehearsal (four packages) | The pins; steps 7, 8 and 9 compare before any call moves |
| A plugin needs something from the environment that the short list leaves out | Possible; one plugin reads three more names on a path meant to go | Step 3 is alone, before the move, with a full test run and the pipeline's rollback |
| A plugin writes somewhere a non-root user cannot | Unknown: idle only was rehearsed | Step 10b is a deploy of its own after the cutover, with a full test run, so it can come out alone |
| Scoping the environment is read as isolation | Likely, from the name | Section 4 says where it stops. A taken-over plugin in the gateway's container is contained by the user it runs as, not by its environment |
| A bad plugin change takes the gateway down with it | Possible, and new in kind: today a broken plugin build leaves the gateway image alone | The gateway starts without a plugin that will not start; the health wait and put-back in the host script; the pipeline's rollback |
| Every plugin change drops every session | Certain | Same as today. Accepted by the ruling |
| The image grows or builds slowly enough to matter | Unknown | Measured at step 8, before anything depends on it |
| A rollback lands on an image that expects the volume after the volume is gone | Would be an outage of every plugin | Step 12's condition: not before the image the pipeline would roll back to loads from the image |
| The new order of a tool change leaves a tool listed but not served | Possible if a removal is deployed before its DELETE | Section 5's order; `registry:diff` names every tool that differs before the deploy; the ground-truth check after it |
| Step 11 removes a tool without anyone noticing | Possible: one tool exists only for the standalone login | Same two checks |
| A plugin crash-loops unnoticed | Possible, and true today: it is restarted without end | Step 3: the limit, and `down` on `/health`. Seen when the daily check next runs, not at once; that delay is accepted with the ruling against a new alert path |
| A plugin that is down goes unseen because `/health` still says ok | Possible: anything that reads only the status code sees nothing | On purpose (section 4). The check that matters reads the field |
| The freeze window stretches | Likely if steps 8 and 9 surprise | The emergency path; phase 0 is done before the freeze |
| A cached turbo build leaves `server/` stale | Certain without the `outputs` line | Section 3; the image build runs from a clean tree with no turbo cache |
| Someone commits to an old repo after the import | Likely over weeks | Branch rule at step 4, archive at step 12 |
| A leak sits in imported history or commit messages | The repos are already public, so the import publishes nothing new | The scan still runs over the range. A finding is an existing exposure to rotate and report |

Not addressed, on purpose: the names-only blind spot of the in-repo ground-truth test; removing
the dead install and uninstall paths from `plugin-manager`; a plugin's reach over the gateway's
network (the section on the shared network is the record).

## 10. Rulings, and the goes still needed

Ruled: **the plugins stay inside the gateway container, built into its image, with one rollback
id (2026-10-09, reversing the container half of 2026-10-07)**; each plugin process is started
with only its own environment, and gets no OAuth client credential; the shared-network question is ruled A (2026-10-09); SCRUM-393
stays absorbed; connectors are service plugins, with the four consequences listed at the top;
the import, port and wiring as specified; the dependency pins for the first image that carries
the plugins; one README per plugin read at build time; `registry:diff` reading CI's tool files
only; the branch rulings in section 7.

Carried by the ruling and no longer in this work: per-plugin images and compose services, the
URL override, the retry and worded errors, per-plugin memory limits, separate cutovers.

**Ruled on 2026-10-09, closing the six questions revision 6 left open:**

1. **A non-root user for each plugin process: in,** as its own deploy after the cutover (step
   10b), one user per plugin. It is what makes "never the gateway's keys" hold, for the
   gateway's environment and memory, against a plugin that has been taken over and not only
   against an accident. It changes nothing about what a plugin can reach on the network or
   read from world-readable files in the image.
2. **The `$NAME` rows: the feature is deleted,** with no allow-list (section 4, step 3).
3. **The restart limit: made real,** and a plugin that hits it shows as `down` on `/health`.
   No new alert path (section 4, step 3).
4. **The ground-truth check after a deploy that touched `plugins/`:** the existing post-deploy
   routine.
5. **The rollback drill at the cutover: yes,** in a window named when the go is given.
6. **The order of a tool change: as proposed** in section 5, proven at step 11.

Accepted with no action: both plugins cut over in one deploy; and a plugin process, which is
our own code, can reach the gateway over loopback and send the edge's header (the
shared-network section).

Answered in this revision, because step 3 needed it: where a plugin gets an OAuth client id and
secret once its environment is scoped. It gets none, and never did (section 4).

Nothing in this spec is open for a ruling. What remains is permission to act.

A separate go for each of steps 3, 9, 10, 10b and 11, and for the host half of step 12.
