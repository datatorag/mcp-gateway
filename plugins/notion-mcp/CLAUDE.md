# CLAUDE.md

## Project

Notion MCP plugin for the DataToRAG gateway (SCRUM-366). Exposes six
read-only Notion tools via MCP over HTTP. Design and stages:
`docs/architecture/2026-10-02-scrum-366-notion-connector-design.md` and
`docs/plans/2026-10-02-scrum-366-notion-connector.md`.

## Commands

- `pnpm run build`: compile TypeScript (src/ to server/)
- `pnpm run dev`: watch mode
- `pnpm run start`: run the compiled HTTP server
- `pnpm test`: `tsc` over the whole tree (tests included), then vitest

## Architecture

- `src/index.ts`: HTTP entry point, `/health` and `/mcp` only. The gateway's
  plugin manager sets `PORT`; `X-User-Token` is read once per session
- `src/create-server.ts`: builds the MCP server. The dispatch hands each tool
  a client scoped to that tool's `readOnlyHint` (`client.forTool`)
- `src/notion-client.ts`: fetch to `https://api.notion.com`, `Notion-Version`
  pinned to `2026-03-11`, Bearer token from `X-User-Token`, refuses a call
  with no token. Throws `NotionApiError` (status, code). Rewrites
  `object_not_found` into the not-shared-or-missing words with how to share,
  and 401 into reconnect words naming `list_connected_accounts`
- `src/rate-limit-retry.ts`: gws-mcp's SCRUM-364 rule (429 or 529 only,
  three attempts, Retry-After as whole seconds or an HTTP date, 8 s budget),
  keyed on the TOOL being read-only, not on HTTP method, because
  `POST /v1/search` and `POST /v1/data_sources/{id}/query` are reads. A
  write is never retried
- `src/notion-id.ts`: an id or a Notion URL to the dashed id
- `src/properties.ts`: one decoder per property type to a plain value;
  unknown types pass through by type name, never thrown
- `src/tools/notion.ts`: the six tool schemas and the `handleNotion()`
  switch; `src/tools/annotations.ts` the `READ` preset; `src/tools/response.ts`
  the shared response helpers
- `src/fixtures/`: test support, excluded from the build. The `.json` files
  are recorded responses (stage 0, 2026-10-21), scrubbed of names, emails,
  avatar and file URLs and the workspace name. The `.ts` files marked "shape
  from Notion's API reference, not recorded" are written from the reference
- `datatorag.json`: plugin manifest (env var names, never values). Notion's
  OAuth has no scopes; `scopes` is an empty list because the manifest type
  requires the field

## Key facts

- Notion answers `404 object_not_found` both for a page that does not exist
  and for one not shared with the connection (observed). The tools never
  claim which
- The rate limit is per connection per workspace, about 180 a minute;
  observed refusal: 429 `rate_limited`, `Retry-After: 16`. That wait is past
  the retry budget, so it comes back in words
- Search matches titles only
- Every list tool returns `{results, has_more, next_cursor}` and takes
  `cursor`; descriptions describe and do not instruct, held by
  `src/tools/described-not-instructed.test.ts` for every tool
- Tests use a stubbed fetch and fixtures, never a live call. A live smoke
  test against a test workspace is still required before claiming a tool
  works end to end

## Where this lives

A workspace package (`@datatorag-mcp/notion-mcp`) of the datatorag-mcp
repository, at `plugins/notion-mcp`. Run its scripts from the repository
root: `pnpm --filter @datatorag-mcp/notion-mcp run build` and `... run test`.
There is one lockfile, at the root.

It is a service plugin of the gateway, not a standalone server: the gateway
starts it as `plugin-notion-mcp` (uid 903), sets `PORT`, and sends one
user's access token per session in `X-User-Token`. Its environment holds
`PATH`, `NODE_ENV` and `PORT` and nothing else.

The skills and workflow guidance are in the root `.claude/skills/`: start
with `codebase-map`, then `gws-mcp-dev` for plugin work. Keep only facts
about this plugin in this file.
