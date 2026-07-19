---
name: gws-mcp-dev
description: Use when developing the gws-mcp plugin repo (~/git/gws-mcp) — adding or changing Google Workspace tools. Tool-definition patterns, client/auth model, manifest, build chain, and the ship tail back into the gateway (plugin update, docs, changelog).
---

# gws-mcp Development

`gws-mcp` (DataToRag/gws-mcp, public, local clone `~/git/gws-mcp`) is the
Google Workspace MCP plugin the gateway installs — a separate repo, separate
release cycle from `datatorag-mcp`. It wraps the `gws` CLI binary
(googleworkspace/cli, Rust) rather than calling Google APIs directly.

## Repo anatomy

- `src/tools/*.ts` — one file per service: `gmail.ts`, `calendar.ts`,
  `contacts.ts`, `docs.ts`, `drive.ts`, `sheets.ts`, `slides.ts`, `tasks.ts`,
  `auth.ts`, plus `generic.ts` (the `gws_run` fallback) and `response.ts`
  (shared response helpers). `src/tools/index.ts` aggregates every module's
  tool array into `allTools` and builds the `toolHandlers` dispatch map.
- `src/gws-client.ts` — the `GwsClient` wrapper. `src/create-server.ts` /
  `src/extension.ts` (stdio, Claude Desktop `.mcpb`) / `src/index.ts`
  (HTTP; defaults to port 39147 standalone — under the gateway the
  plugin-manager overrides it via `PORT` env to 40000+) are the two
  entry points.
- `datatorag.json` — the plugin manifest the gateway reads: `name`,
  `description`, and an `oauth` block (`scopes`, `authorizeUrl`/`tokenUrl`,
  `clientIdEnv`/`clientSecretEnv` — env var *names*, no secret values).
- Build: `package.json`'s `build` script, `scripts/download-binaries.sh`.
- No test framework — verification is `tsc --strict` plus a live smoke test
  against real Google APIs, documented in the merge commit message.

**The `gws` binary model, in two sentences**: `GwsClient.exec()` shells out
to a prebuilt `gws` binary (one per platform, in `bin/`) via
`child_process.execFile`, passing `--params <json>` / `--json <body>` and
parsing stdout as JSON; app-level OAuth client id/secret come from
`oauth.json` or `GWS_OAUTH_CLIENT_ID`/`_SECRET` env, while the per-user
access token is injected per call via `GwsClient.withToken()` (the
"unified OAuth" model — the gateway holds each user's Google token and
hands it to `GwsClient` per request, no per-user `gws auth login`).
`spawnAuthForUrl()` is only for the desktop/extension path: it spawns
`gws auth login` in the background and scrapes the OAuth URL off stderr.

## Adding or changing a tool

1. **Define the schema** in the relevant `src/tools/<service>.ts` file, in
   that file's tool array. Follow the conventions below (verbose
   parameter-documenting descriptions, `annotations: { destructiveHint,
   readOnlyHint }` on every tool — `false`/`true` for read-only fetches,
   `true`/`false` for anything that sends/writes/deletes). Factor a shared
   param shape into one object spread across multiple schemas rather than
   repeating it (see `emailFields` in `gmail.ts`).
2. **Implement the handler** in the same file's `handle<Service>()`
   switch. Use `client.api(service, resource, method, { params, jsonBody,
   pageAll, dryRun })` for direct REST calls or `client.helper(service,
   command, flags)` for `gws` CLI shorthand subcommands. Return via the
   shared helpers in `response.ts`: `jsonResponse(data)` (truncates at
   900KB, MCP caps near 1MB), `textResponse(text)`, `deleteResponse(name)`,
   `deleteDriveFile(client, fileId)` (Sheets/Docs/Slides deletes are Drive
   deletes underneath — route through this instead of duplicating the call).
3. **Register** — adding to a service file's exported tool array and
   `handle<Service>()` switch is enough; `src/tools/index.ts` picks it up
   automatically via `register()`, no separate wiring step.
4. **Build + verify locally**: `pnpm run build` (`download-binaries.sh`
   then `tsc`), confirm it's clean, then run a live smoke test against the
   real API for the tool you touched (read-only calls first) — there is no
   test suite, so this is the actual verification step. Note what you
   tested in the eventual commit/PR body, matching this repo's convention.
5. **PR to main** — see Conventions below for message shape.

## Ship tail

After the PR merges into `~/git/gws-mcp` main, this is separate from and
in addition to landing the merge itself:

1. **Prod plugin update + tool re-discovery** — pull/rebuild the plugin in
   its running container and re-run tool discovery so the gateway's `tools`
   table matches the new tool set. See the `ops-debugging` skill's "Plugin
   update + tool re-discovery" recipe.
2. **Gateway docs + changelog + tool-count check** — if the change is
   user-visible (new tool, changed behavior), add a changelog entry and
   update the relevant `apps/gateway/content/docs/*.md` page, and recheck
   any tool-count claims in copy (e.g. "50 tools total") since they drift
   per tool added/removed. See the `site-content` skill's publish
   checklist; use the `content-marketer` agent to draft the changelog/docs
   prose.
3. **Session re-auth note**: gateway MCP sessions are in-memory only — the
   restart in step 1 drops all live sessions for this connector. This is
   expected, not a regression; users just re-auth on their next tool call
   (see `ops-debugging`).

## Conventions

- Commits: `feat: <summary> (#N)` on merge, occasional bare imperative
  subject for small fixes. Body explains *why*, not just what — e.g. `PR
  #8`'s body documents the regression it fixes, not just the new params.
  Larger cleanup PRs (e.g. `PR #9`) use a structured Features/Cleanup body
  and end with a `Verified: ...` line naming exactly what was smoke-tested.
  `Fixes #N`/`Closes #N` trailers link issues.
  `Co-authored-by: Claude <model> <noreply@anthropic.com>` trailer on
  nearly every commit.
- Schema descriptions are verbose and parameter-documenting, not just a
  noun phrase — `gmail_read` is the model: its `text_only` param spells
  out exactly what the compact view contains (flattened headers, decoded
  text/plain body with HTML fallback, attachment metadata) and when to
  prefer it ("Recommended for triage — avoids base64 attachment data
  overflowing the response").

## Gotchas

- **`download-binaries.sh` must run before `tsc`.** The plugin manager's
  install step is just `npm run build`; if the binary-download step were
  ever dropped from that script, a fresh install ENOENTs on the first gws
  call (this exact bug was fixed in `c85505f`, "Include binary download in
  build step" — keep the two steps chained in `build`, don't split them).
- **Dotted API paths in `gws_run`.** Resources nest under a parent —
  `users.messages`, `users.drafts`, `users.messages.attachments` — not
  bare names like `drafts`. Get this wrong and the CLI's API-discovery
  step fails (exit code 4).
- **Scalar-only query params.** The `gws` CLI's `--params` only serializes
  flat scalar values. A comma-joined multi-value string (e.g.
  `metadataHeaders: "From,Subject"`) looks like one opaque scalar to the
  underlying REST call and silently matches zero results — it does not
  error, it just returns nothing useful. This exact bug shipped and was
  fixed in `ab0ffef`: `gmail.ts`'s `fetchMessageList()` now uses plain
  `format: "metadata"` plus client-side flattening instead. Don't
  reintroduce a repeated/array query param through `--params`.
