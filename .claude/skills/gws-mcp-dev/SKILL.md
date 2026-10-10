---
name: gws-mcp-dev
description: Use when developing a connector plugin under plugins/ (gws-mcp, atlassian-mcp): adding or changing tools. Where the plugins live now, tool-definition patterns, the client and auth model, build and test, the freeze window, and the ship tail back into the gateway.
---

# Plugin development (gws-mcp, atlassian-mcp)

The two connector plugins live in this repository, at `plugins/gws-mcp` and
`plugins/atlassian-mcp`, as workspace packages `@datatorag-mcp/gws-mcp` and
`@datatorag-mcp/atlassian-mcp`. They were imported from their own
repositories with their history (SCRUM-390). Those repositories are frozen:
`main` is locked on both, and nothing new goes there.

Each plugin's `CLAUDE.md` (`plugins/<slug>/CLAUDE.md`) holds the facts about
that plugin and is the first thing to read. This skill holds what is common
to both and what crosses into the gateway.

**A connector is a service plugin of the gateway, not a standalone MCP
server.** The gateway starts it as a child process, gives it a port, and
hands it one user's access token per call in the `X-User-Token` header. A
plugin holds no app credentials and its environment is `PATH`, `NODE_ENV`
and `PORT` and nothing else (see `codebase-map`).

## Where things are, and the window we are in

| Thing | Now |
|---|---|
| Source | `plugins/<slug>/src`, compiled by `tsc` to `plugins/<slug>/server` (gitignored) |
| Build and test | `pnpm --filter @datatorag-mcp/<slug> run build` and `... run test` from the repo root. One root lockfile; a plugin has none of its own |
| Gate | `scripts/gate.sh`: a path under `plugins/<slug>/` runs that plugin's build and tests and the gateway's |
| Image | The gateway's `Dockerfile` compiles both plugins and ships them at `/app/plugins/<slug>`. There is no plugin image |
| What production runs | **The copies in the image**, since the cutover (the spec's step 10): the `Dockerfile` sets `DATATORAG_PLUGINS_DIR=/app/plugins` and the manager starts each plugin from there. A change under `plugins/` ships with the gateway image through the pipeline, and a rollback of the image is the rollback of the plugins. The checkouts of the old repositories are still in the plugins volume until the close-out; nothing starts them, and an image from before the cutover would |
| Who a plugin runs as | In the image, its own non-root account `plugin-<slug>` (the `Dockerfile` creates one per plugin; the manager starts the child with that user and group). It can read and run its code and cannot write it, has no home directory, and cannot read the gateway's process or the other plugin's. So a plugin must not write beside its code or under a home directory: use the system temp directory, or nothing. On a laptop it runs as you |
| Tool files | When CI builds the gateway image it starts each plugin from it and keeps `tools-<slug>.json` (what the plugin SERVED: name, description, schema, read-only hint) beside the image's digest record. `scripts/image-plugin-tools.sh <image> <dir>` does the same locally |

A plugin change ships like any gateway change: a pull request, the gate, the
image, the pipeline. Nothing is pulled or compiled in the running container
any more. If the change alters a tool's description, schema or read-only
hint, the registry row changes too, by a file `pnpm registry:diff` writes
from the two commits' tool files and a person runs (`ops-debugging`).

The plan, its steps and what each one proves:
`docs/architecture/2026-10-06-scrum-390-plugins-into-the-gateway-repo.md`.

**Reading a file's history.** `git log -- plugins/gws-mcp/src/tools/gmail.ts`
shows only the import commit. The real history is
`git log --full-history -- src/tools/gmail.ts plugins/gws-mcp/src/tools/gmail.ts`.

## Anatomy (both plugins)

- `src/tools/*.ts`: one file per service, tool schemas plus a
  `handle<Service>()` dispatch. `src/tools/index.ts` aggregates them.
- `src/index.ts`: the HTTP entry point the gateway starts. It also serves
  the private file routes beside `/mcp` (`/internal/file-bytes` on
  `gws-mcp`, `/internal/consume` on `atlassian-mcp`).
- `datatorag.json`: the manifest (`name`, `description`, an `oauth` block of
  scopes and env var *names*, never values).
- Tests: vitest, beside the module, driven through a fake client. They
  cannot show a missing or reshaped upstream response; a live call is still
  the proof for anything that touches a provider's API.

**`gws-mcp` specifics.** Every call is a `fetch` built from the generated
method table in `src/google-api/`, with the user's token the gateway sends.
No process is started; the `gws` CLI, the desktop bundle and the stdio
entry point are gone (step 11 of the spec), and a test fails if a source
file imports `node:child_process`. A call with no token is refused.
`src/google-api/oracle.test.ts` holds the request builder equal to what the
CLI reported it would send, from a recording in `oracle.fixtures.json`, so
the tests download nothing. A method added to the method table has no
recorded request and fails there by name: the expected request is then
written from the API's Discovery document and reviewed as an expectation a
person wrote. `gws_auth_setup` is still served and answers that the gateway
handles authentication; removing it is a registry change of its own.

**`atlassian-mcp` specifics.** Calls the Atlassian REST API directly through
`src/atlassian-client.ts`.

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
   pageAll, dryRun })`. Return via the
   shared helpers in `response.ts`: `jsonResponse(data)` (truncates at
   900KB, MCP caps near 1MB), `textResponse(text)`, `deleteResponse(name)`,
   `deleteDriveFile(client, fileId)` (Sheets/Docs/Slides deletes are Drive
   deletes underneath — route through this instead of duplicating the call).
3. **Register** — adding to a service file's exported tool array and
   `handle<Service>()` switch is enough; `src/tools/index.ts` picks it up
   automatically via `register()`, no separate wiring step.
4. **Build + verify locally**: `pnpm --filter @datatorag-mcp/<slug> run
   build`, confirm it's clean, run `... run test` (vitest; unit-test the
   handler with a fake client), then run a live smoke test against the
   real API for the tool you touched (read-only calls first) — unit tests
   cover wiring and error shaping, only a live call verifies actual API
   behavior. Note what you tested in the eventual commit/PR body.
5. **PR to this repository's main**, through the gate like any other change.

## Ship tail

A plugin change is a gateway change: one PR here, and after the cutover one
gateway deploy carries it. What goes with it:

1. **A surgical registry change**, by exactly the rows the PR changed: an
   existing tool that changed gets one `UPDATE` of its row, a new tool one
   `INSERT`, a removed tool one `DELETE`. Never a full re-discovery; the
   table does not resync itself (SCRUM-138). Generate the file, never write
   it by hand: `pnpm registry:diff <slug> --from <running gateway sha> --to
   <new gateway sha>` writes `forward.sql` and `rollback.sql` from the two
   commits' tool files in CI. Every statement is guarded by the md5 of the
   row as the running commit served it, both files are headed NOT RUN, and
   the command opens no database connection: a person runs the file. Both
   commits must have been built on main after tool files were kept. The
   order against the deploy is in the spec's section 5. Prove the result
   from `tools/list` through the gateway, not from the plugin's source.
2. **Gateway docs + changelog + tool-count check**: if the change is
   user-visible, add a changelog entry, update the relevant
   `apps/gateway/content/docs/*.md` page, and recheck tool-count claims in
   copy. See `site-content`; the `content-marketer` agent drafts the prose.
3. **Playground write-gate classification**: a NEW tool fails closed in the
   playground until it is classified: add it to the snapshot in
   `apps/gateway/src/gateway/playground/tool-classification.test.ts` and,
   if it is a read, to `KNOWN_READ_TOOLS` in
   `apps/gateway/src/gateway/playground/tools.ts`, in the same commit.
4. **Sessions**: a gateway deploy restarts the gateway, which drops every
   live MCP session. Expected; clients re-initialize on their next call.

## Conventions

- Schema descriptions are verbose and parameter-documenting, not just a
  noun phrase. `gmail_read` is the model: its `text_only` param spells out
  exactly what the compact view contains and when to prefer it.
- Every tool declares its annotations; in `gws-mcp` through the presets in
  `src/tools/annotations.ts`, never hand-written booleans.
- A commit body explains why, and names what was smoke-tested live.

## Gotchas

- **Dotted API paths in `gws_run`.** Resources nest under a parent —
  `users.messages`, `users.drafts`, `users.messages.attachments` — not
  bare names like `drafts`. Get this wrong and the call is refused as an
  unknown method before any request.
- **Repeated query params are arrays, never comma-joined strings.** An
  array of scalars goes out as a repeated query key
  (`ranges=A&ranges=B`), which is what `ranges`,
  `metadataHeaders`, `labelIds` and every other `repeated` parameter want.
  A comma-joined string (`metadataHeaders: "From,Subject"`) is one opaque
  value that matches nothing and errors nowhere (shipped once, fixed in
  `ab0ffef`). An array of objects or arrays is refused before the call by
  `assertCarriableParams` in `gws-client.ts`, because the element would
  go out as one stringified value and Google blames the caller's input.
  Until SCRUM-178 the client refused EVERY array on a belief about the
  transport that was never measured; the recorded requests in
  `oracle.fixtures.json` pin what is sent, so a claim about the transport
  is checked against a recording, not remembered.
