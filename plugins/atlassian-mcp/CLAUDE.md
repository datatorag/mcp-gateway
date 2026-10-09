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

## Cross-repo guidance

DataToRAG development runs from the datatorag-mcp session; the canonical
skills and workflow guidance (including the design-time "Quality pass"
checklist) live in that repo's `.claude/skills/` —
<https://github.com/datatorag/mcp-gateway>, start with `codebase-map`.
Keep only repo-specific facts in this file; don't duplicate cross-repo
guidance here, it drifts.
