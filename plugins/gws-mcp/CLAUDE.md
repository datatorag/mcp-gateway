# CLAUDE.md

## Project

Google Workspace service plugin of the DataToRAG gateway. Calls the Google REST APIs directly, with the user's token the gateway sends, to expose 68 tools (Gmail, Calendar, Drive, Contacts, Sheets, Docs, Slides, Tasks, generic API access) via MCP. It starts no process and holds no login of its own.

## Commands

- `pnpm run build` — compile TypeScript (src/ → server/)
- `pnpm run dev` — watch mode
- `node scripts/generate-method-table.mjs` — regenerate `src/google-api/method-table.ts` from Google's Discovery documents

## Architecture

One entry point: `index.ts`, the HTTP transport the gateway starts on the port it sets. It builds each session's server with `createMcpServer()` from `create-server.ts`.

`gws-client.ts` is the client every tool calls. `api()` is a `fetch` built from the generated method table in `src/google-api/`, with the bearer token the gateway sent. With no token it refuses the call. The `gws` CLI, the desktop bundle and the stdio entry point were removed (SCRUM-390): nothing here may import `node:child_process`, and a test fails if a source file does.

`src/google-api/oracle.test.ts` holds the request builder equal to what the gws CLI reported it would send, from a recording (`oracle.fixtures.json`). A method added to the table has no recorded request and fails there by name; the test's header says what to do.

`gws_auth_setup` is still served, with its old definition, and answers that the gateway handles authentication. Removing it is a change to the served tool list and to the registry, so it is a change of its own.

## Key conventions

- ESM (`"type": "module"`), all imports use `.js` extensions
- TypeScript strict mode, target ES2024, NodeNext module resolution
- Output dir is `server/` (not `dist/`)
- Use `pnpm`, not `npm`
- Tests: `pnpm test` (vitest — typechecks the test files, then runs them).
  Unit tests live beside the module and drive handlers through a fake
  `{ api }` client, so they need no network. They cannot catch a changed
  upstream response shape: a live smoke test against the real API is still
  the verification for anything touching a Google endpoint.

## Tool annotations

Every tool declares `annotations` via a preset from `src/tools/annotations.ts`,
never hand-written booleans — the three shapes were copied out 55 times and
eight had drifted to wrong values:

- `READ(title)` — cannot modify anything. Reads, searches, lists, gets.
- `CREATE(title)` — adds something new; cannot overwrite or destroy.
- `MUTATE(title)` — overwrites or removes existing state, or has an
  irreversible effect outside our system (sending mail, sharing a file).

`MUTATE` is the safe default when unsure: over-prompting costs a click,
under-prompting costs the user something they cannot get back. `ToolDef`
makes `annotations` and both hints required, so an unannotated tool is a
compile error rather than a silent one (under MCP defaults an absent
`destructiveHint` reads as TRUE and an absent `readOnlyHint` as FALSE).

The `title` is what a user reads in a confirmation prompt, so it must say
what will actually happen — that is consent, not copy. "Insert text into
document", not "Write document content"; "Run any Google Workspace API call
(fallback)", not "Run Google Workspace API call".

## Where this lives

This plugin is a workspace package (`@datatorag-mcp/gws-mcp`) of the
datatorag-mcp repository, at `plugins/gws-mcp`. It was imported from its own
repository with its history; that repository is frozen. Run its scripts
from the repository root: `pnpm --filter @datatorag-mcp/gws-mcp run build`
and `... run test`. There is one lockfile, at the root.

It is a service plugin of the gateway, not a standalone server: the gateway
starts it, sets `PORT`, and sends one user's access token per session in
`X-User-Token`. Its environment holds `PATH`, `NODE_ENV` and `PORT` and
nothing else.

The skills and workflow guidance are in the root `.claude/skills/`: start
with `codebase-map`, then `gws-mcp-dev` for plugin work. Keep only facts
about this plugin in this file.
