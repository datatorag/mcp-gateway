# CLAUDE.md

## Project

Slack MCP plugin for the DataToRAG gateway (SCRUM-454). Exposes Slack's Web
API through MCP over HTTP with the user's own token: six reads and four
writes. Design and stages:
`docs/architecture/2026-11-01-scrum-454-slack-connector-design.md` and
`docs/plans/2026-11-01-scrum-454-slack-connector.md`.

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
- `src/slack-client.ts`: `slackCall` (and `SlackClient.call`, the same with
  the token and retry rule carried): GET with query params for reads, POST
  JSON for the four write methods, Bearer token, 60 s timeout, refuses a
  call with no token. Throws `SlackApiError` (Slack's `error` code, method,
  HTTP status) on `ok: false`, `SlackUnreachableError` when no answer came.
  Rewrites `missing_scope` and the refused-token codes into reconnect words.
  Also `resolveChannel` (id or `#name`; a name matching two channels is
  refused with both ids), `resolveMentions` (`<@U…>` to `@name`, one lookup
  per person per call), `paginate`/`nextCursor`, and `trimText` (2,000
  characters, the shared truncation marker)
- `src/rate-limit-retry.ts`: notion-mcp's copy of gws-mcp's SCRUM-364 rule
  for Slack (HTTP 429 or `ratelimited`, three attempts, `Retry-After` in
  whole seconds, 8 s budget), keyed on the TOOL being read-only. A write is
  never retried; a write that got no answer says it may have landed
- `src/tools/annotations.ts`: `READ`, `WRITE` (destructive: a post, a DM, an
  edit) and `ADDITIVE` (a reaction: a write, not destructive)
- `src/fixtures/`: test support, excluded from the build. The `.json` files
  are written from Slack's Web API reference (documented example
  responses), not recorded, with test ids (`C000TEST1`, `U000TEST1`) and
  example.test addresses

## Key facts

- Slack answers most refusals with HTTP 200 and `{ok: false, error}`; a rate
  refusal is HTTP 429 with `Retry-After` in seconds
- A user token reads public channels and the user's own private channels
  and DMs; `search.messages` accepts only a user token
- Tests use a stubbed fetch and fixtures, never a live call. A live smoke
  test against the company workspace is still required before claiming a
  tool works end to end

## Where this lives

A workspace package (`@datatorag-mcp/slack-mcp`) of the datatorag-mcp
repository, at `plugins/slack-mcp`. Run its scripts from the repository
root: `pnpm --filter @datatorag-mcp/slack-mcp run build` and `... run test`.
There is one lockfile, at the root.

It is a service plugin of the gateway, not a standalone server: the gateway
starts it as `plugin-slack-mcp` (uid 905), sets `PORT`, and sends one
user's access token per session in `X-User-Token`. Its environment holds
`PATH`, `NODE_ENV` and `PORT` and nothing else.

The skills and workflow guidance are in the root `.claude/skills/`: start
with `codebase-map`, then `gws-mcp-dev` for plugin work. Keep only facts
about this plugin in this file.
