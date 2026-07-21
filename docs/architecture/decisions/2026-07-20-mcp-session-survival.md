# MCP sessions: 404 on unknown session id (spec re-init) + user-bound sessions

- **Date:** 2026-07-20
- **Who:** Manuel + Claude (product session); SCRUM-23
- **Status:** accepted
- **Log line:** 2026-07-20 · Unknown MCP session id returns 404 (spec-compliant client re-init) and sessions are user-bound

## Context

Sessions live in an in-memory Map, so every deploy wiped them while clients still held
their old `mcp-session-id`. The stale id fell into the new-session init branch, whose
fresh transport rejects a non-initialize body — clients surfaced "session expired" and
demanded manual re-auth even though the Postgres-backed bearer was still valid.
Observed five times in one day: every ship dropped every connected user. Key commit:
`3ecc847`; teardown interplay in `8b48ecc`.

## Alternatives considered

- **Persist sessions in Postgres so they survive deploys** — real complexity
  (serializing transport state, cleanup, another hot-path table) to preserve something
  the protocol already defines a recovery for. The MCP Streamable HTTP spec says an
  unknown/terminated session id gets HTTP 404 and the client MUST transparently start
  a new session — the client-side self-heal was already mandated; the server just
  wasn't triggering it.
- **Graceful drain on deploy (finish sessions before restart)** — doesn't help
  crashes or scale-out, and long-lived SSE sessions never drain.
- **Do nothing (document manual re-auth)** — five user-visible outages in a day made
  that untenable.

## Decision

Extract the routing decision into `classifyMcpRequest` (`mcp-session.ts`,
unit-tested): a request bearing an unknown session id gets `404
{error:"session_not_found"}`, prompting the client to re-initialize transparently.
Additionally, each session is bound to the userId of the bearer that initialized it —
a session id presented with a *different* user's valid bearer classifies as unknown
(404) rather than routing into the original user's `McpServer`, closing the hijack
window if a session UUID ever leaks.

## Consequences

- Deploys are no longer user-visible events: confirmed in prod 2026-07-21 — next
  deploy dropped zero sessions.
- Per-user teardown elsewhere (e.g. token revoke) can be deliberately broad, because
  innocent clients recover silently through this 404 path.
- Sessions remain in-memory and single-instance by design; if the gateway ever runs
  multiple replicas, session affinity (or this same 404-re-init behavior across
  replicas) is the mechanism to lean on, not shared session state.
- Any change to session routing must keep `classifyMcpRequest` the single decision
  point (it is unit-tested precisely so this behavior can't regress silently).
