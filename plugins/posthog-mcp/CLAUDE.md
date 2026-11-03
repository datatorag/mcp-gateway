# CLAUDE.md

## Project

PostHog MCP plugin for the DataToRAG gateway (SCRUM-471). Ten read-only
tools over PostHog's REST and query APIs, in one project, via MCP over HTTP.
Design and plan: `docs/architecture/2026-11-02-scrum-471-posthog-connector-design.md`
and `docs/plans/2026-11-02-scrum-471-posthog-connector.md`.

## Commands

- `pnpm run build`: compile TypeScript (src/ to server/)
- `pnpm run start`: run the compiled HTTP server
- `pnpm test`: `tsc` over the whole tree (tests included), then vitest

## Architecture

- `src/index.ts`: HTTP entry point, `/health` and `/mcp` only; the headers
  are read once per session
- `src/session-context.ts`: `X-User-Token`, `X-PostHog-Host` (exactly one of
  the two regional hosts) and `X-PostHog-Project` (digits). Anything else and
  the session's calls are refused before any request
- `src/posthog-client.ts`: every path under `/api/projects/{project}/`;
  templates in log lines; two requests at once; 401, 403 and 429 in words
- `src/rate-limit-retry.ts`: a 429 retried once, only inside an 8-second budget
- `src/tools/posthog-read.ts`: the ten tools, all READ

## Rules

- No writes, and no write scope on the connection.
- Every range takes its end; an open end makes a number drift.
- A value never goes into HogQL text: `posthog_events_list` passes each one
  as a placeholder in `values`.
- Never return a project's API token or its test-account filter values.
- No em-dashes in any description; a test holds it.
