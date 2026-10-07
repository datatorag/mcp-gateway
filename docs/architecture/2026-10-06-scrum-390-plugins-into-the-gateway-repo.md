# SCRUM-390: the plugins move into the gateway repo

Status: SPEC, revision 2 (design reviewed and accepted; the migration is reordered so the
release mechanism is proven before the import). No code has moved, nothing is deployed, the
deploy script is untouched. Written against `main` at `c82f58c`, `gws-mcp` main at `27ea0fc`, `atlassian-mcp` main at
`b8b82a0`, on 2026-10-06.

The decision is made and not reopened here: `gws-mcp` and `atlassian-mcp` become pnpm
workspace packages at `plugins/gws-mcp` and `plugins/atlassian-mcp`, history kept, and each
plugin stays its own deploy unit with its own rollback id. This document says how.

**How to read the claims.** Three kinds, marked where it matters:

- *Read*: taken from the code or config at the shas above.
- *Rehearsed*: run in a throwaway clone on a laptop (import, install, build, test, release
  directory, branch port). Nothing was pushed and the clone is deleted. A laptop is not the
  host: it proves the commands and the package layout, not the container or the volume.
- *Proposed*: design that no command has exercised yet. Every host-side step is in this class.
  This pass did not connect to the host; what it says about the host comes from
  `scripts/deploy-gateway.sh`, `docker/docker-compose.prod.yml` and the `deploy` and
  `ops-debugging` skills.

## 1. What this spec refuses

1. **Plugins are not baked into the gateway image.** One image is one rollback id for three
   surfaces, which the constraint forbids. Section 4 gives the trade-off in both directions.
2. **The import PR is never squash-merged or rebase-merged.** `main` is unprotected and the
   repo allows all three merge styles (read from the GitHub API). A squash flattens the history
   the move exists to keep, and a rebase rewrites every imported sha, including the ones old
   rollback ids name. The import lands as a merge commit or a fast-forward, or not at all.
3. **No history rewrite on the way in.** `git filter-repo --to-subdirectory-filter` gives
   nicer `git log -- <path>` output and changes every sha. Existing deploy records name plugin
   shas; plain `git subtree add` keeps them resolvable in the new repo (rehearsed).
4. **Location and content never change in the same commit.** The two import commits carry
   trees byte-equal to the plugin repos' tips. Renames, lockfile removal and workspace wiring
   are a second PR, so "the move changed nothing" is a hash comparison, not a review.
5. **No general `plugin-sdk` in this work.** Section 3 says what falls out and what does not.
   Section 10 names the thing worth building instead.
6. **No toolchain unification during the move.** The plugins keep NodeNext, `.js` import
   suffixes, `server/` as output and their own TypeScript majors (7 and 5).
7. **The registry write stays a human's.** One command will generate the file. Nothing in
   this spec runs SQL against production.
8. **The security gate and the leak scan are never path-filtered.** Filters decide what is
   built and tested. A filter on a disclosure gate is a hole with a config file.
9. **The host's working checkout is not a build input for plugins.** The gateway deploy
   moves it. A plugin release builds from `git archive <sha>`.
10. **This does not claim the rollout gets shorter.** A new tool still ships as plugin, then
    registry row, then gateway. What collapses is three branches, three gates and three
    ancestry checks into one, and a hand-copied contract into one source.
11. **The old repos are not deleted,** and not archived until a rollout from the new layout
    has succeeded.

## 2. Today, from the code

| Fact | Where it is read |
|---|---|
| Workspace is `apps/*` and `packages/*`; turbo `build` outputs are `dist/**` and `.next/**` | `pnpm-workspace.yaml`, `turbo.json` |
| The gateway imports nothing from a plugin and no plugin imports from the gateway. The slugs appear in the gateway only as strings | `apps/gateway/package.json`; grep for the two slugs |
| A plugin on the host is a git checkout at `<volume>/<slug>`, built in place inside the gateway container, started as a child with `spawn("node", entrypoint, { cwd })` | `plugin-manager.ts` (`PLUGINS_DIR`, `startAll`, `spawnPlugin`), `deploy` skill step 5 |
| The volume is `plugins-data` mounted at `/root/.datatorag/plugins`. The gateway `Dockerfile` copies `packages/*` and `apps/gateway` by name and nothing else | `docker-compose.prod.yml`, `apps/gateway/Dockerfile` |
| `deploy-gateway.sh` deploys one sha of `main` as an image, tags the running image `rollback-<sha>`, and does not touch plugins | the script's own header |
| A plugin's rollback id is its previous sha: check it out in the volume, compile, restart the gateway | `deploy` and `ops-debugging` skills |
| A plugin release restarts the whole gateway process, which drops every MCP session | `ops-debugging` skill; sessions are an in-process `Map` |
| A test run records each plugin's sha by reading `<slug>/.git/HEAD` | `apps/gateway/src/gateway/tests/plugin-sha.ts` |
| `registry-ground-truth.test.ts` asks the plugin for `tools/list` and compares **names only**, and only when `PLUGIN_MCP_URLS` is set. Unset, it reports skipped | the test file |
| The registry (`tools` table) is never re-discovered; each change is one guarded statement | `ops-debugging` skill |
| No repository of the three has a CI workflow | no `.github/` directory in any of them |

Three things today's layout hides, found while reading:

- **The generator for registry change files is in none of the three repos.** Each rollout's
  guarded statements were produced by a script that lived in a session. (Searched: the three
  repos' tracked files and the private ops scripts. Not searched: session scratch.)
- **The skills describing the plugins have drifted from the plugins.** `gws-mcp-dev` says the
  plugin uses npm, wraps the CLI binary for every call and downloads binaries during `build`;
  the plugin's own `CLAUDE.md` at `27ea0fc` says pnpm, direct REST calls with a token, and an
  opt-in download. The `deploy` skill's plugin table lists one of the two plugins. Two repos
  describing one thing is the defect the move removes.
- **`plugin-manager.install()` clones a repo and expects the manifest at its root.** Nothing
  in the gateway calls it since the public install routes were removed. It cannot install a
  plugin that lives in a subdirectory, and section 5 does not rely on it.

## 3. Layout

| Thing | Becomes | Why |
|---|---|---|
| Directory | `plugins/gws-mcp`, `plugins/atlassian-mcp` | The directory name stays the slug. The slug is in `mcp_servers.slug`, every namespaced tool name and `PLUGIN_SERVICE_MAP` |
| `package.json` name | `@datatorag-mcp/gws-mcp`, `@datatorag-mcp/atlassian-mcp` | Matches the workspace scope. Nothing resolves a plugin by package name at runtime |
| `package.json` `files` | `["server", "datatorag.json", "README.md", "LICENSE"]` | `server/` is gitignored; without `files`, the release directory in section 4 would not contain it. With it, rehearsed |
| Lockfiles | Both per-plugin lockfiles (each plugin tracks an npm one and a pnpm one) are deleted; the root `pnpm-lock.yaml` gains two importers | One lockfile. See the dependency note below |
| Workspace | add `"plugins/*"` to `pnpm-workspace.yaml` | |
| `turbo.json` | add `server/**` to `build.outputs` | Load-bearing: a cache hit restores only declared outputs, so without this a cached plugin build leaves `server/` stale or absent and exits 0 |
| tsconfig | Each plugin keeps its own. Neither extends `tsconfig.base.json` | The base sets bundler resolution; the plugins run under plain `node` and need NodeNext. A shared `plugins/tsconfig.base.json` is a later tidy-up, not part of the move |
| Lint | Nothing to share | No package in any of the three repos has a lint script or an eslint config; the root `lint` task runs nothing |
| `.dockerignore` | add `plugins/` | The gateway image must not see plugin source; a check in `scripts/gate.sh` fails if the gateway `Dockerfile` ever copies it |
| `.mcpb` desktop extension | Still packed from `plugins/gws-mcp` by its own script | No GitHub releases exist on the plugin repo, so no download URL moves |

**Build and test.** `pnpm -r build` and `pnpm -r test` work once the glob is added (rehearsed:
both plugins compile; `atlassian-mcp` passes its suite; `gws-mcp` passes all of its suite
except the oracle, see below). `turbo run build --filter='...[<base>]'` selects exactly the
changed package and its dependents (rehearsed: a plugin-only commit selects that plugin alone;
a `packages/types` commit selects `types` and the gateway).

**Two things the rehearsal found that a reading would not:**

- **The move is not a no-op for dependencies.** Re-resolving under the root lockfile moved
  four transitive production packages of `gws-mcp` forward (`ajv`, `jose`, `zod`,
  `eventsource-parser`, patch or minor) while the MCP SDK stayed at the same version. They are
  pinned for the first monorepo release and unpinned later as a change of its own. The pin
  that works (rehearsed, production package list then identical, 91 of 91): `pnpm.overrides`
  for `ajv`, `jose` and `eventsource-parser`, and `zod` declared as a direct pinned dependency
  of the plugin, because `zod` arrives only as an auto-installed peer of the SDK and an
  override did not move it. `atlassian-mcp`'s drift was not measured; the same check finds it.
- **A fresh checkout's `pnpm -r test` is red.** The `gws-mcp` oracle test fails, by design
  never skips, when the pinned CLI binary is absent, and the binary is a gitignored download.
  The plugin's `test` task must depend on `download-binaries` in `turbo.json`. With the binary
  present the suite passes in full.

**What the gateway and the plugins share, and what to do about each.**

| Shared by copy today | Copies | After the move |
|---|---|---|
| The file-crossing wire contract: the two private route paths, the token header, the arguments header, the `{error, code}` answer and its code list, the byte cap | gateway `file-crossing.ts`, `gws-mcp` `internal/file-bytes.ts`, `atlassian-mcp` `internal/consume.ts` | **`packages/plugin-contract`**: constants and types only, no runtime dependency, built to `dist/` like its siblings. This is the one package that falls out. It is a follow-up PR after the first rollout, because it changes plugin code |
| Tool names | plugin tool arrays; gateway `registry-snapshot.ts`, `KNOWN_READ_TOOLS`, `FILE_CONSUMING_TOOLS`, runner cases | No package. A gateway test can now boot the built plugin from the same tree and compare, with no `PLUGIN_MCP_URLS` (a tree-consistency check; the live check stays) |
| Google scope list | gateway `scope-grant.ts`, `gws-mcp` manifest and `scopes.ts` | Same: a test across the tree, not a package |
| Response helpers, annotation presets | Each plugin has its own, and they are not copies of each other | Left alone. A shared helper package is the general SDK this spec declines |

## 4. Deploy

### The choice

| | A. Volume, immutable releases (recommended) | B. Plugins inside the gateway image |
|---|---|---|
| Rollback id | `(surface, sha)` per surface | One image tag for everything |
| Plugin-only fix | Builds one plugin, seconds | Full gateway build; minutes and gigabytes of cache |
| Plugin-only rollback | Re-point a link, restart. Nothing compiles | None without rolling the gateway back too. A volume override on top of the image would give one, and would make two sources of truth for what runs |
| Cross-surface change | Still ordered by hand | Atomic. This is B's real advantage and the reason to reconsider it if the constraint ever relaxes |
| State outside the image | The volume | None; a new host needs nothing but the image |
| Compose file | Unchanged | Volume removed |

A is recommended because the constraint requires it. Under A the plugin release still restarts
the gateway process, so "independent" means the artifact and the rollback id, **not** the blast
radius: both kinds of deploy drop every MCP session. A path filter describes the diff, never
what a deploy does.

### What the volume holds (proposed)

```
/root/.datatorag/plugins/
  gws-mcp -> .releases/gws-mcp/<sha>          # what PluginManager opens; a relative symlink
  .releases/gws-mcp/<sha>/
    server/  node_modules/  package.json  datatorag.json  README.md
    RELEASE                                    # source repo and sha, built-at, tool digest,
                                               # hash of server/, production package list
```

`PluginManager` joins `PLUGINS_DIR` and the slug and never lists the directory (read), so a
symlink at `<slug>` needs no change to it. A release directory is built under a temporary name
and renamed only when complete, so one that exists is whole. That removes the failure where
the checkout says the new sha and `server/` holds the old build.

A release directory holds the compiled output, the manifest and a production-only
`node_modules`: no source, no git metadata. The script takes its source as a repository plus an
optional directory inside it, so it works on a plugin repo today and on this repo after the
import. Only the packaging sub-step differs, and both forms are rehearsed (24 MB for `gws-mcp`
either way; it boots standalone, answers `initialize`, and its private route refuses a
tokenless call):

| Source | Packaging |
|---|---|
| A plugin repo (the plugin is the repo root) | Copy `server/` and the manifests, then a frozen production install from the plugin's own lockfile. `pnpm deploy` refuses to run outside a workspace |
| This repo after the import (`plugins/<slug>`) | `pnpm --filter <pkg> deploy --prod <dir>`. Trap: it left a stray directory beside the plugins, inside the `plugins/*` glob, so it runs from an archive outside any checkout |

The same source compiled under both layouts gave a byte-identical `server/` (rehearsed, by
content hash). That is what lets the import be checked as "the artifact did not change".

### `scripts/release-plugin.sh <slug> <full-sha> [--source <repo>[:<dir>]]` (proposed; a new file)

| Step | What | Stops if |
|---|---|---|
| 1 | Fetch the source; `git merge-base --is-ancestor <sha> origin/main` there | The sha is not on that source's `main` |
| 2 | Compare the plugin's tree hash at `<sha>` with the running release's | Equal, and the lockfile is too: nothing to release, say so (an identity release needs `--force`) |
| 3 | `git archive <sha>` of the plugin (and, in this repo, the root manifests and lockfile) into a temp dir | |
| 4 | Build in a one-off container from the running gateway image, `NODE_ENV=development`: frozen install, `build`, then the packaging form above into `.releases/<slug>/<sha>.tmp` | Install or `tsc` is non-zero, or `server/index.js` is missing or older than the step |
| 5 | Boot the release on a spare port inside that container, read `tools/list`, write `RELEASE` (tool digest over names, descriptions, schemas and read-only hints; `server/` hash; production package list); rename `.tmp` to final | The plugin does not answer |
| 6 | Print the rollback id (the link's current target) and stop for the go | |
| 7 | Re-point the link atomically, `compose restart gateway`, health | Health never ok: re-point back, restart |
| 8 | Ask the **running** plugin for `tools/list`; its digest must equal the one in `RELEASE` | They differ: the process is not serving what was built |
| 9 | Keep the newest five releases per plugin | |

Steps 1 to 5 change nothing that production reads and are safe to run at any time.
`--rollback <slug> <sha>` is steps 7 and 8 against a release directory that already exists.

The one-off container is not the live one on purpose: the live container runs with
`NODE_ENV=production`, under which an install skips the compiler and the build exits 0 with the
old output in place, and a compile inside it counts against the gateway's memory cap.

### What the gateway deploy becomes

`deploy-gateway.sh` is not changed by this spec. Two consequences of one repo, both read from
the script and the `Dockerfile`:

- It requires the requested sha to be the tip of `main`. Plugin-only commits advance that tip.
  A gateway deploy of such a tip rebuilds an image with identical gateway content, which is
  harmless and worth saying in the record.
- It never releases a plugin, because the image copies no plugin directory. A commit touching
  both surfaces is two deploys with two records, in a stated order.

**The record.** A deploy row names `surface` (`gateway`, `plugin:gws-mcp`,
`plugin:atlassian-mcp`, `registry`) and the monorepo `sha`. For a plugin it also carries the
subtree hash, which answers "did this surface change between these two shas" exactly: across a
gateway-only commit the hash is unchanged (rehearsed).

### One gateway change the new layout needs first

`plugin-sha.ts` reads `<slug>/.git/HEAD`. A release directory has no `.git`, so every test run
would record `sha unknown` for both plugins and the baseline-against-post diff would lose its
subject. The reader must prefer `RELEASE` and fall back to git. This ships in a gateway deploy
**before** the first release-directory rollout (migration step 1).

## 5. Registry

**Today.** A plugin change that alters a tool's description, schema or existence needs a
change file: one guarded statement per row (the guard is the md5 of the description and of
`input_schema_json::text` as the old build produces them), a row-count assertion,
`updated_at = now()`, and a rollback file. It is generated from two builds of the plugin repo,
by a script kept in none of the repos, then carried to the session that may write to
production.

**After.** One command in this repo, proposed:

```
pnpm registry:diff <slug> --from <sha> --to <sha>     # writes forward.sql and rollback.sql
```

For each sha it archives the plugin, builds it, **boots it and asks it** for `tools/list`
(the served list, not the source array: a plugin can withhold a tool it defines), and emits
the same guarded statements used today, headed NOT RUN. It never opens a database connection.
It takes the same `--source` as the release script, so it works on a plugin repo before the
import.
`--from` is the sha in the running release's `RELEASE` file. The digest it computes is the one
`release-plugin.sh` writes in step 5 and checks in step 8, so the file, the release and the
post-restart check share one definition of "what the plugin serves".

The generator has one hard part and it gets a self-test: the guard must reproduce Postgres's
`jsonb::text` rendering exactly (key order, spacing), or every guard misses and the file
safely does nothing. Fixtures are public tool schemas with their known md5s.

**The drift gate and where a tool comes from.**

| Place | Assumption | After the move |
|---|---|---|
| `registry-ground-truth.test.ts` | Slug to URL from `PLUGIN_MCP_URLS`; no repo assumption | Unchanged. Its blind spot stays: names only, so a changed schema or description passes |
| `tests/plugin-sha.ts` | A plugin directory is a git checkout | Must read `RELEASE` (section 4) |
| `mcp_servers.github_repo_url`, `_owner`, `_name` | One repo per plugin, manifest at its root | Whatever the rows hold names a per-plugin repo (not read in this pass). Changing them is a production write; ruled in review: left as they are |
| `buildPluginServerUrl` (`user-tools.ts`) | A non-null repo URL means "runs locally" | The column must stay non-null whatever it points at |
| `/tools/[slug]` page | README from the plugin directory, else GitHub's README for the repo | The local read still works (`README.md` is in `files`). The fallback would serve the archived repo's README, frozen |
| Skills (`deploy`, `ops-debugging`, `gws-mcp-dev`, `codebase-map`) | Separate repos, checkout in the volume | Rewritten in the wiring PR (freshness rule) |
| Ops scripts kept outside this repo (drift check, build check, leak scan) | Slug to port map; a git checkout at `<volume>/<slug>`; one repo path per scan | Swept in the same change as the first rollout; listed in the report, not here |

A new tool is still: plugin release, then the INSERT, then the gateway that classifies it.
One tree means the tool, its classification and its runner case are one commit and one review.
It does not make the live-registry classification test green before the row exists.

## 6. Gates

**Today.**

| Gate | gateway repo | `gws-mcp` | `atlassian-mcp` |
|---|---|---|---|
| Security reviewer | Agent defined in the repo; run on `origin/main...HEAD` before push | No agent definition; run from the gateway session by convention | Same |
| Leak scan (diff and commit messages) | Private script, one run per repo path | Same script, second run | Third run |
| Ancestry check before push | Yes | Yes | Yes |
| Tests | `pnpm vitest run`, `tsc --noEmit`, `pnpm build` in `apps/gateway` | `pnpm test` (typecheck of tests, then vitest) | `pnpm test` |
| Pattern check and database guards | Claude Code hooks in `.claude/settings.json` | None | None |
| CI | None | None | None |

Every gate runs only when a person or an agent types it.

**After: one range, one script** (`scripts/gate.sh [base]`, proposed, default base
`origin/main`).

1. Always, on the whole range: ancestry check, security reviewer, leak scan. Never filtered.
2. Map changed paths to surfaces and run only those surfaces' builds and tests through
   `turbo --filter='...[base]'`.
3. Print the surfaces that changed and, for each plugin, whether its served tool digest
   changed (which means a registry file is owed).

| Changed path | Surface | Runs |
|---|---|---|
| `plugins/<slug>/**` | `plugin:<slug>` | That plugin's build and tests (binary download first for `gws-mcp`), tool digest |
| `apps/gateway/**` (content included), `packages/**`, `docker/**` | `gateway` | Gateway tests, typecheck, production build |
| `pnpm-lock.yaml`, root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json` | every surface | Everything. Conservative on purpose: narrowing a lockfile change by importer is possible and not worth being wrong about |
| `docs/**`, `.claude/**`, `scripts/**` | none | The hook scripts' own tests when `scripts/hooks/**` changes |

A plugin-only change therefore runs one plugin's suite (seconds) and no Next.js build. The
existing hooks fire for plugin work from the day of the move, because they are declared at the
repo root; whether the pattern check's rules mean anything for plugin code is not established.

**CI.** One workflow running `scripts/gate.sh` on pull requests ships in the same PR as
`gate.sh` (migration step 2), and becomes a required check on `main`. What it can and cannot
run, so a green check is not read as more than it is:

| In the workflow | Not in the workflow, still run before a push |
|---|---|
| Ancestry check, path filter, the selected builds, typechecks and tests | The security reviewer (an agent) and the leak scan (its pattern list is private by design) |
| The `gws-mcp` binary download, so the oracle test runs | Every suite gated on a database or a running plugin: they report skipped, and skipped is not passed |

Turning squash and rebase merging off and protecting `main` is not part of that PR and not a
decision: it is a repository setting changed before step 1.

## 7. Migration

The release mechanism is built and proven against **today's plugin repos** first. By the time
anything is imported, immutable releases are already how both plugins run, so the import
changes one thing: where the source lives.

Preconditions, done before step 1: squash and rebase merging are off on this repo and `main` is
protected; one operator is named for the deploy queue.

**Phase 1: the mechanism, with the plugins still in their own repos.**

| # | Step | Verification | Rollback |
|---|---|---|---|
| 1 | **Gateway prep PR**, deployed the normal way: `plugin-sha.ts` prefers `RELEASE` and falls back to git | Its tests against a fixture with `RELEASE`, with `.git`, with neither. After the deploy a test run still records both plugin shas (they are still checkouts) | Revert; redeploy the rollback image |
| 2 | **Tooling PR**: `release-plugin.sh`, `registry:diff`, `gate.sh`, the CI workflow. Each script has a self-test with a known-bad case | Self-tests. `registry:diff` between the two most recent plugin shas reproduces the guards of the last change file that was actually run. The workflow is seen red on a deliberately failing PR before it is trusted green | Revert the PR; nothing on the host uses it yet |
| 3 | **Dry release on the host**, script steps 1 to 5, both plugins, from the plugin repos at the shas that are running | The built release's tool digest equals the **running** plugin's, and its `server/` hash equals the running checkout's `server/`. Same source, same compiler: any difference is the mechanism's and is explained before step 4 | Delete the release directories; nothing read them |
| 4 | **First real release through the mechanism, its own go: `atlassian-mcp`, at the sha it already runs.** Baseline test run. Move the checkout aside (`<slug>.pre-release`), create the link, restart | Health. Running digest equals `RELEASE`. Post run diffs to zero against the baseline, and the recorded plugin sha is unchanged (now read from `RELEASE`). Drift check clean. One live read through the connector | Remove the link, move the checkout back, restart. The old directory is complete, so nothing compiles |
| 5 | **`gws-mcp` the same way, separate go.** Not in the reviewed sequence; proposed so that `gws-mcp` does not meet the new mechanism and the new source on the same day. Strike it and step 11 carries both changes for that plugin | As step 4, plus one Gmail read and the private route refusing a tokenless call | As step 4 |

An ordinary plugin change that lands during phase 1 can be released through the mechanism
from its plugin repo; that is the first non-identity release and worth doing before phase 2.

**Phase 2: the source moves.**

| # | Step | Verification | Rollback |
|---|---|---|---|
| 6 | **Freeze the plugin repos.** Record both `main` tips. Lock `main` on each (a branch rule, not archiving) | A push to `main` is refused | Remove the rule |
| 7 | **Import PR**, two commits and nothing else (commands below), merged as a merge commit or fast-forward | `git rev-parse HEAD:plugins/<slug>` equals `<tip>^{tree}` in the plugin repo, for both. The old shas resolve (`git cat-file -t`). Commit count is the three counts plus two. Leak scan and security gate over the whole range. `git status` clean | Do not merge; after merge, revert the two commits. `plugins/` is inert here: not in the workspace, not in the image |
| 8 | **Port what is kept**: `git format-patch` in the old repo, `git am --directory=plugins/<slug>` here | The ported branch's `plugins/<slug>` tree equals the source branch's tree | Delete the branch |
| 9 | **Wiring PR**: workspace glob, package names, `files`, lockfiles, the dependency pins, `turbo.json`, `.dockerignore`, plugin rows in `gate.sh`, the skills, each plugin's `CLAUDE.md` | Frozen install is clean. Test totals per plugin equal the pre-move totals at the same source. Gateway suite, typecheck and build unchanged; the image builds and contains no `plugins/`. A release directory built from the workspace has the same `server/` hash and the same production package list as the running release's `RELEASE` | Revert the PR |
| 10 | **Dry release on the host from this repo**, both plugins, at the wiring tip | Tool digest, `server/` hash and production package list all equal the running release's. Only the source and sha in `RELEASE` differ | Delete the release directories |
| 11 | **First release from the monorepo, its own go**, `atlassian-mcp` then `gws-mcp` | Health. Running digest equals `RELEASE`. Post run diffs to zero; the recorded plugin sha changes from a plugin-repo sha to a monorepo sha with no behaviour change, and the report says so | `release-plugin.sh --rollback` to the previous release directory: a link flip, nothing compiles |
| 12 | **Close out.** Deploy records. Old repos: a final README commit naming the new home, open issue transferred, then **archived**. `.pre-release` checkouts deleted. The dependency pins come out later as a change of their own, released and diffed like any other | The archived repos refuse a push. A fresh clone of this repo builds and tests both plugins | Unarchive |

The repos are **frozen** at step 6 and **archived** at step 12. Between the two, anything
committed to them is orphaned, which is why the freeze is a rule on the branch and not a habit.

```bash
# Step 7. Run from a branch off main; <tip> is the frozen main sha of each plugin repo.
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

**Branches on the old repos.** `scrum-384-*` are merged in both. Not ancestors of `main` as of
2026-10-06, from `git ls-remote` against each remote and not from a local clone's tracking refs,
which still listed branches the remote had deleted:

| Repo | Branch | Ruling |
|---|---|---|
| `gws-mcp` | `scrum-392-sheets-coercion-sentence` | Keep. In flight: it ships from the plugin repo before step 6, or is ported in step 8 (rehearsed: one commit, authorship and date kept, resulting tree equal to the source) |
| `gws-mcp` | `feature/chore/gws-cli-0.22.5` | Keep; ported in step 8. Its unpushed local commits are pushed first, or they are not in the port |
| `gws-mcp` | `scrum-278-gmail-signature` | Drop. Stays readable in the archive |
| `atlassian-mcp` | `feature/fix/jira-search-response-shape` | No ruling yet |

Local-only branches and a stash exist on the development machine; an import cannot see them.

**Local development after the move.** A laptop's plugin directory is a clone today. It becomes
a link from `~/.datatorag/plugins/<slug>` to `plugins/<slug>` in one checkout, built in place.
With several worktrees that link names one of them, so it is set by a script that prints which.

## 8. If the pending branches land first

| Branch | Touches | Effect on this spec |
|---|---|---|
| `chore-deploy-prune-build-cache` | `deploy-gateway.sh`, `deploy` skill | None. This spec adds a new script and leaves that one alone |
| `chore-remove-compose-postgres` | Prod compose loses the database services; skills | None. `plugins-data` is kept by that branch, and option A changes no compose line. The wiring PR rebases its skill edits onto it |
| SCRUM-384 spec branch | One architecture document | It is the prose form of the contract that `packages/plugin-contract` encodes; that PR cites it |
| Notion connector (SCRUM-366), a design and a plan on its branch | No code yet | It is born at `plugins/notion-mcp`. Its plan has a step creating a plugin repo `notion-mcp` laid out like `atlassian-mcp`; that step becomes a directory, and it never has a repo to archive |

## 9. Risks

| Risk | Likelihood | What holds it down |
|---|---|---|
| The import PR is squashed by habit | Removed by the precondition | Squash and rebase are off before step 1; the old shas are checked after the merge anyway |
| The first monorepo release differs from what runs because dependencies re-resolved | Seen in rehearsal (four packages) | The pins; step 10 compares the package list, `server/` hash and tool digest before any flip |
| A cached turbo build leaves `server/` stale | Certain without the `outputs` line | Section 3; the release script builds from an archive with no cache and checks the file's age |
| The one-off build container behaves unlike the laptop (image contents, volume permissions, a symlink through a named volume) | Unknown: proposed, not exercised | Step 3 finds out with nothing at stake, and before the source has moved |
| A test run records `sha unknown` for plugins | Certain without step 1 | Step 1 ships first |
| Someone commits to an old repo after the import | Likely over weeks | Branch rule at step 6, archive at step 12 |
| A leak sits in imported history or commit messages | The repos are already public, so the import publishes nothing new | The scan still runs over the range. A finding is an existing exposure to rotate and report, not something the import can fix by rewriting |
| Plugin and gateway deploys race on one host | Same as today | One operator per deploy queue; the two scripts share a lock file (step 2) |
| The root lockfile couples surfaces: a gateway dependency bump touches the file a plugin release reads | Low | The plugin's tree hash plus its importer section decide "changed", not the file |
| A green CI check is read as the whole gate | Likely | The table in section 6; the security reviewer and the leak scan stay pre-push steps |

Not addressed, on purpose: plugin children inheriting the gateway's full environment; the
names-only blind spot of the in-repo ground-truth test. Restarting one plugin alone is declined
here too, and section 10 says what it is so it can be ticketed.

## 10. Declined here, worth a ticket: restart one plugin without restarting the gateway

**The cost today.** Every plugin release restarts the gateway process. That drops every MCP
session for every user on every connector, and ends whatever lives in process memory: agent
runs in flight, a running test run (marked interrupted at boot), scheduled skill runs mid-turn.
A one-line description fix in one plugin costs the same as a gateway deploy. After this spec
that is still true: option A gives a plugin its own artifact and rollback id, not its own blast
radius.

**What it would take** (read from `plugin-manager.ts`; nothing here is built or measured):

| Piece | State today |
|---|---|
| `restartPlugin(slug)`: stop the child, wait for it to exit, start it again on the same port, wait for health | The parts exist. `spawnPlugin` re-resolves `<slug>` on every start, so a re-pointed link is picked up. The exit handler already treats SIGTERM as deliberate and does not respawn. `waitForHealth` exists. Missing: waiting for the exit before binding the port again, which matters because a leftover process holding a plugin port has happened |
| A trigger the release script can reach from the host | None. The public plugin routes were removed, and admin routes are cookie-only, which a host script has no cookie for. Candidates: an admin-only built-in over MCP, or a signal to the gateway process naming nothing and re-reading each link. This is the design question in the ticket |
| Calls in flight | Both plugins are called through one-shot clients with nothing pooled, so the gateway holds no connection to drop. Calls already inside the plugin fail; a file crossing in flight fails on the leg it was in. A generic pooled plugin would also need its pool entries removed (`removeServer` exists) |
| Sessions | Untouched. They belong to the gateway process, which stays up |
| The release script | Step 7 becomes "restart this plugin"; step 8's digest check is unchanged |

**Why it is worth more than any shared package.** A contract package removes a class of
mistake at review time. This removes a user-visible outage from every plugin release and
rollback, makes "plugin-only" true of the blast radius and not only of the diff, and makes
small plugin fixes cheap enough to ship when they are ready.

## 11. Decisions

Taken in review: option A; the dependency pins for the first monorepo release; branch
protection as a precondition and the CI workflow in the tooling PR; the `mcp_servers` repo
columns and the README fallback left as they are; `scrum-392` and the CLI bump branch kept,
`scrum-278` dropped.

Still open:

1. The go on the plan as a whole, and a separate go for each of steps 4, 5 and 11.
2. Whether step 5 stays (`gws-mcp` onto the mechanism before the import) or is struck.
3. The `atlassian-mcp` branch `feature/fix/jira-search-response-shape`: keep or drop.
