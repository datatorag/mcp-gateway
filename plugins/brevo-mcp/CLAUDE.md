# CLAUDE.md

## Project

Brevo MCP plugin for the DataToRAG gateway (SCRUM-468). Twenty tools over
Brevo's v3 API via MCP over HTTP. Design and plan:
`docs/architecture/2026-11-01-scrum-468-brevo-connector-design.md` and
`docs/plans/2026-11-01-scrum-468-brevo-connector.md`.

## Commands

- `pnpm run build`: compile TypeScript (src/ to server/)
- `pnpm run start`: run the compiled HTTP server
- `pnpm test`: `tsc` over the whole tree (tests included), then vitest

## Architecture

- `src/index.ts`: HTTP entry point, `/health` and `/mcp` only; `X-User-Token`
  is read once per session
- `src/create-server.ts`: the dispatch hands each tool a client scoped to its
  `readOnlyHint` (`client.forTool`)
- `src/brevo-client.ts`: fetch to `https://api.brevo.com/v3`, Bearer token.
  Paths are TEMPLATES with values beside them, so a log line prints the
  template and never a contact's address. 401, 402 and 429 in words
- `src/rate-limit-retry.ts`: a read's 429 retried only when
  `x-sib-ratelimit-reset` fits an 8-second budget; a write never
- `src/tools/brevo-read.ts`, `src/tools/brevo-write.ts`: the tools.
  READ, WRITE (reversible) and MUTATE (an email leaves Brevo) annotations

## Rules

- One tool call is one Brevo call, except `campaign_send` (its checks) and
  `list_members_update` with both directions. Brevo's hourly limits are low.
- HTML only when asked, always capped; a template list never carries it.
- No em-dashes in any description; a test holds it.
