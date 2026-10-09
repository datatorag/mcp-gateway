# CLAUDE.md

## Project

Google Workspace MCP extension for Claude. Calls the Google REST APIs directly (the `gws` CLI remains only as a no-token self-host fallback and for login) to expose 68 tools (Gmail, Calendar, Drive, Contacts, Sheets, Docs, Slides, Tasks, generic API access) via MCP.

## Commands

- `pnpm run build` — compile TypeScript (src/ → server/)
- `pnpm run dev` — watch mode
- `pnpm run build:extension` — compile + pack into `google-workspace-mcp.mcpb`
- `pnpm run download-binaries` — fetch gws binaries into bin/ (opt-in: needed for self-hosted login, the no-token fallback, and the oracle test; `build` no longer runs it)
- `node scripts/generate-method-table.mjs` — regenerate `src/google-api/method-table.ts` from Google's Discovery documents

## Architecture

Two entry points sharing `createMcpServer()` from `create-server.ts`:

- `extension.ts` — stdio transport for `.mcpb` (Claude Desktop). Auto-triggers browser OAuth login on first run.
- `index.ts` — HTTP transport on port 39147 for Claude Code / standalone use.

`gws-client.ts` is the client every tool calls. With a bearer token (every hosted call) `api()` is a `fetch` built from the generated method table in `src/google-api/`; it never spawns a process and never loads the CLI. With no token it falls back to `cli-transport.ts`, which wraps the `gws` binary (Rust, in `bin/`) and also owns the login flow. `src/google-api/oracle.test.ts` holds the request builder equal to the pinned CLI's `--dry-run` for every method; it fails, not skips, when the binary is missing. The token goes in the `Authorization` header only. OAuth client ID and secret are read from `GWS_OAUTH_CLIENT_ID` / `GWS_OAUTH_CLIENT_SECRET` env vars and passed to the binary on the fallback path.

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

## Extension packaging

- `manifest.json` defines the `.mcpb` extension (entry: `server/extension.js`)
- `.mcpbignore` excludes src/, tsconfig, dev deps, google-cloud-sdk/
- Binaries for macOS (arm64, x64) and Windows (x64) are bundled in `bin/`
- Pack with `mcpb pack . google-workspace-mcp.mcpb`

## Cross-repo guidance

DataToRAG development runs from the datatorag-mcp session; the canonical
skills and workflow guidance (including the design-time "Quality pass"
checklist) live in that repo's `.claude/skills/` —
<https://github.com/datatorag/mcp-gateway>, start with `codebase-map`.
Keep only repo-specific facts in this file; don't duplicate cross-repo
guidance here, it drifts.

## Auth flow

The extension uses OAuth Desktop app credentials. On startup, `extension.ts` checks auth status in the background. If unauthenticated, it spawns `gws auth login`, captures the auth URL from stderr, and opens it in the system browser. Users must have a GCP project with APIs enabled and OAuth credentials configured (see README).
