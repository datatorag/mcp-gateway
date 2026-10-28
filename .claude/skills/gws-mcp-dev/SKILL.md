---
name: gws-mcp-dev
description: Use when developing a connector plugin under plugins/ (gws-mcp, atlassian-mcp, notion-mcp): adding or changing tools. Where the plugins live now, tool-definition patterns, the client and auth model, build and test, the freeze window, and the ship tail back into the gateway.
---

# Plugin development (gws-mcp, atlassian-mcp, notion-mcp)

The connector plugins live in this repository, at `plugins/gws-mcp`,
`plugins/atlassian-mcp` and `plugins/notion-mcp`, as workspace packages
`@datatorag-mcp/<slug>`. The first two were imported from their own
repositories with their history (SCRUM-390); `notion-mcp` started here. Those repositories are frozen:
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
| Image | The gateway's `Dockerfile` compiles every plugin and ships them at `/app/plugins/<slug>`. There is no plugin image |
| What production runs | **The copies in the image**, since the cutover (the spec's step 10): the `Dockerfile` sets `DATATORAG_PLUGINS_DIR=/app/plugins` and the manager starts each plugin from there. A change under `plugins/` ships with the gateway image through the pipeline, and a rollback of the image is the rollback of the plugins. The plugins volume is no longer mounted (the close-out, step 12), so an image from before the cutover would start no plugin and is not a rollback target. The old repositories are archived; their READMEs name this one |
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

## Anatomy (every plugin)

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
person wrote. There is no authentication tool: `gws_auth_setup` was removed
(SCRUM-412), and a 401 from Google names the gateway's
`list_connected_accounts` tool and the connections page instead.

**`atlassian-mcp` specifics.** Calls the Atlassian REST API directly through
`src/atlassian-client.ts`.

**`notion-mcp` specifics.** Calls Notion's REST API through
`src/notion-client.ts` with `Notion-Version: 2026-03-11` pinned, so a new
Notion version changes nothing until the header moves. Rate refusals
(429, Notion's 529) are retried only for tools marked read-only, never by
HTTP method, because search and data-source queries are POSTs. Notion
answers an unshared page and a missing one with the same 404
`object_not_found`; the client words both. 18 tools: six reads
(`src/tools/notion.ts`) and twelve writes (`src/tools/notion-write.ts`),
every write annotated destructive and never retried. Content goes in as
Notion's markdown; property values go in and out as plain values
(`src/properties.ts` reads, `src/encode.ts` writes against the data
source schema). Deleting a page is `notion_update_page` with `in_trash`,
and a duplicate is a read plus a create. Its writes have rules in the
runner's send guard (see Conventions). It was born in this repository
(SCRUM-366), so it has no imported history.

**Adding a plugin.** Three places name each plugin one by one and refuse or
skip an unknown one: the gateway `Dockerfile` (its files and a
`plugin-<slug>` account, without which it is never started),
`scripts/gate.sh`'s path table (an unlisted plugin path falls to `all`,
which runs every suite except the new plugin's), and `PLUGIN_SERVICE_MAP`.
CI's tool-file step loops over `plugins/` and needs nothing. Its
`mcp_servers` row, without which the manager never starts it, comes from
the registry pair like its first tools (Ship tail), never by hand.

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
   the command opens no database connection. The pair is committed under
   `registry/` and run on production by the `registry` workflow, approved
   in GitHub (SCRUM-423; `registry/README.md`), once its role and secret
   exist; until then a person runs the file. Both
   commits must have been built on main after tool files were kept. The
   order against the deploy is in the spec's section 5. Prove the result
   from `tools/list` through the gateway, not from the plugin's source.

   **A new plugin goes through the same command** (SCRUM-366). When
   `plugins/<slug>` does not exist at the running sha, the missing tool
   file is read as an empty set and the forward file also inserts the
   plugin's `mcp_servers` row, first, in the same transaction: name and
   manifest from `datatorag.json`, description from it or `package.json`,
   license from `package.json`, a source link into this repository (the
   call path needs it set), status `active`, and the lowest port from
   40000 that no row holds, chosen and checked by the statement. It raises
   if the slug has a row; the rollback deletes the tools and then that
   row, md5-guarded, and refuses while an env var or plugin connection
   row points at it. When the running image already carries the plugin,
   pass `--new-plugin` to force the same files; the insert's slug guard
   makes that safe. The registry role needs a grant change (drafted in
   `registry/roles/`, applied by HQ) before the workflow can run such a
   file, and a new plugin's order against the deploy is not a tool's:
   `registry/README.md` has both.
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
- **A description describes; it does not instruct** (SCRUM-419). What the
  tool does, what it takes, what it returns. No "always", "never", "must",
  "use this instead of", no capitals for emphasis: those address the
  reader's model rather than describe the tool, and a directory reviewer
  reads them as a tool steering its caller. In `gws-mcp`,
  `src/tools/described-not-instructed.test.ts` holds the rule for the tools
  listed in it by name. A new tool goes on that list; an older description
  is brought under the rule by adding its name and rewording it.
- **A failure says whose it was** (SCRUM-154). Every error a plugin
  answers carries `_meta["datatorag.com/error"]` from `src/error-meta.ts`,
  and the gateway meters on it. So a provider's HTTP refusal is thrown as the
  plugin's typed error with its status (`GwsApiError`, `AtlassianHttpError`,
  `NotionApiError`), never as a plain `Error` with the status in the words: a
  plain `Error` reads as the plugin refusing the request, which is metered.
- **An Office file is not a Google file** (SCRUM-455). Which Office types
  convert to which Google type is one function, `googleTypeFor` in
  `src/tools/office-files.ts`. `drive-ops.ts` holds the two Drive steps
  around it: `getDriveFileMeta` (one `files.get` for the fields named) and
  `convertCopy` (read the type, pick the target, copy), used by
  `drive_copy_file`'s `convert` and `drive_read_file`'s temporary copy. A
  Google API 400 whose reason is FAILED_PRECONDITION is checked in the
  CallTool catch (`officeFileRefusal`), keyed on the request the transport
  attaches to `GwsApiError` (its `service` and path parameters), so gws_run
  is covered too; it never matches Google's words, and an ordinary 400
  costs no Drive call.
- **An alias is declared on the schema** (SCRUM-456). A name callers keep
  reaching for is a property carrying `"x-alias-of": "<canonical>"`
  (`query` on `sheets_find_rows`, `content` on `docs_write`, `body` on
  `gws_run`). `validateArgs` maps it before anything else is checked (a
  string for an array canonical becomes a one-value array), refuses both
  together, and returns what it applied; the CallTool handler attaches
  `aliased` to the answer once (`withAliased`). `required` keeps naming the
  canonical argument, and no handler sees the alias. The alias has to be in
  the schema because the gateway refuses arguments its registry row does
  not list (SCRUM-392).
- **Bytes do not travel through a tool response.** `gmail_get_attachment`
  returns a text attachment as text, up to a stated size, and for anything
  else a description with the size and the save-to-Drive route. A new tool
  that reads a file follows it: text when it is text, never base64.
- **A tool that moves mail gets a rule in the runner's guard, in the same
  change.** `apps/gateway/src/gateway/tests/send-guard.ts` knows tools by
  name. `gmail_trash` and `gmail_untrash` would have been callable on any
  message from a test case until they were added to it; they are now held
  to mail the run itself sent. The same holds past mail (SCRUM-428): a
  thread move needs every message in the thread to carry the run's stamp,
  a share goes only to a fixture account and with notify false, and an
  RSVP needs send_updates none. Notion (SCRUM-366): a write reaches only the
  fixture page, data source and database and what the run created (known by
  the id each create answered with, not by title), every create is titled
  with the smoke prefix and run stamp, and a comment or page content may not
  mention a person. A new `notion_` write tool is refused until it has a rule.

## Gotchas

- **`gws_run` is hidden from everyone but an allowlist (SCRUM-419).**
  The gateway lists and dispatches it only for the login emails in
  `GWS_RUN_ALLOWED_ACCOUNTS` (empty means nobody; values in SSM, never
  here); anyone else gets a fixed refusal naming the dedicated tool
  families, unmetered. The registry row stays. The public tool count and
  `/tools/gws-mcp` leave it out for everyone (`src/lib/public-tools.ts`),
  so a public count is one below the registry's row count. A smoke case
  that calls `gws_run` needs the admin who triggers the run on the list.
  The access rule is `apps/gateway/src/gateway/gws-run-access.ts`; a new
  read of the tools table for a public page goes through
  `public-tools.ts`, not a query of its own.
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
  In `gws_run` a string that parses as a JSON array is taken as that array
  for a param the method table declares `repeated` for that method, and for
  no other param (SCRUM-298, the SCRUM-269 helper `unwrapJsonString`).
  Until SCRUM-178 the client refused EVERY array on a belief about the
  transport that was never measured; the recorded requests in
  `oracle.fixtures.json` pin what is sent, so a claim about the transport
  is checked against a recording, not remembered.
