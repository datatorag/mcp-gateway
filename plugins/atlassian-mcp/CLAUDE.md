# CLAUDE.md

## Project

Atlassian MCP plugin for the DataToRAG gateway. Exposes Jira and Confluence
tools via MCP over HTTP.

## Commands

- `pnpm run build` — compile TypeScript (src/ → server/)
- `pnpm run dev` — watch mode
- `pnpm run start` — run the compiled HTTP server

## Architecture

- `src/index.ts` — HTTP entry point (the gateway's plugin-manager sets the
  port via `PORT` env)
- `src/create-server.ts` — builds the MCP server
- `src/atlassian-client.ts` — Atlassian REST client; per-user access token
  injected per call by the gateway
- `src/tools/jira.ts`, `src/tools/confluence.ts` — one file per service:
  tool schemas + a `handle<Service>()` dispatch switch
- `src/tools/response.ts` — shared response helpers
- `src/internal/consume.ts`: the private `POST /internal/consume` route. The
  gateway hands a file's bytes to a tool here; it is not an MCP tool
- `datatorag.json` — plugin manifest the gateway reads (name, description,
  oauth block with env var *names*, never secret values)

## Key conventions

- ESM, TypeScript strict mode, output dir `server/`
- Use `pnpm`, not `npm`
- `pnpm test` runs `tsc` over the whole tree (tests included) then vitest.
  Tests use fixtures, never a live call, so they cannot show a MISSING or
  wrong-shaped upstream response: pin the REQUEST we send where that is the
  thing that matters, and give every guard a known-bad case alongside its
  happy path. A live smoke test is still required before claiming a tool
  works end to end; record what was smoke-tested in the commit/PR body
- Tool schemas carry verbose parameter-documenting descriptions and
  `annotations: { destructiveHint, readOnlyHint }` on every tool

## Where this lives

This plugin is a workspace package (`@datatorag-mcp/atlassian-mcp`) of the
datatorag-mcp repository, at `plugins/atlassian-mcp`. It was imported from its own
repository with its history; that repository is frozen. Run its scripts
from the repository root: `pnpm --filter @datatorag-mcp/atlassian-mcp run build`
and `... run test`. There is one lockfile, at the root.

It is a service plugin of the gateway, not a standalone server: the gateway
starts it, sets `PORT`, and sends one user's access token per session in
`X-User-Token`. Its environment holds `PATH`, `NODE_ENV` and `PORT` and
nothing else.

The skills and workflow guidance are in the root `.claude/skills/`: start
with `codebase-map`, then `gws-mcp-dev` for plugin work. Keep only facts
about this plugin in this file.

