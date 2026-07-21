# Playground: server-side agentic loop with capped SSE chat and an annotation-driven write gate

- **Date:** 2026-07-19 (write gate extended 2026-07-20)
- **Who:** Manuel + Claude (product session)
- **Status:** accepted
- **Log lines:**
  - 2026-07-19 · Dashboard playground = server-side agentic loop in the gateway (LLM provider factory, capped SSE chat endpoint, per-user message cap in `users.playground_messages_used`)
  - 2026-07-19 · Playground writes need a pre-action confirmation gate, keyed off the MCP `readOnlyHint` annotation rather than verb heuristics

## Context

Signed-in users needed a way to try their connected tools without first wiring up an
external MCP client — the biggest drop-off in activation was "connected account, never
made a tool call." That meant running an LLM agent loop somewhere, against real user
tools, on our API key. Key commits: `f2231f9` (provider factory), `2cfff02` (engine),
`d704ced` (capped SSE endpoint), `3a9d176` (confirmation gate), `6366f56`
(readOnlyHint), `c0c8363`/`975af2c` (cap-refund and abort semantics).

## Alternatives considered

- **Client-side agent loop (browser calls the LLM directly)** — exposes the provider
  API key to the client, and per-user tool access would still have to round-trip the
  gateway. Rejected outright.
- **No cap / billing-metered usage** — no billing enforcement is wired in yet; an
  unlimited free LLM loop is an open spend faucet. A small lifetime per-user message
  cap (`users.playground_messages_used`, atomic `UPDATE...RETURNING` claim, refunded
  on pre-stream or engine failure — never after work is delivered) bounds worst-case
  spend with one integer column.
- **Verb-heuristic-only write detection** — classifying `send/create/delete/...` by
  name misses arbitrary-op runners (`gws_run` executes whatever it's told and matches
  no verb). The MCP `readOnlyHint` annotation is the protocol-native, authoritative
  signal; it is captured at tool discovery into `tools.read_only_hint` and trusted
  first, with the (expanded) verb heuristic only as fallback for unannotated tools.

## Decision

The playground is a server-side agentic loop inside the gateway: a provider factory
behind a `PlaygroundLlm` interface, a pure injectable engine (`runPlaygroundTurn`,
iteration-capped, prompt-cached), streamed to the dashboard over SSE from
`/api/playground/chat`. Every mutating tool call pauses the loop for explicit user
approval (`awaiting_confirmation` + resume token); a write runs only on an explicit
approve. Write-ness comes from `readOnlyHint` first, verbs second.

## Consequences

- LLM spend is ours, bounded by the cap; changing the cap or making it plan-based is
  a billing decision, not an architecture change.
- The pause/resume store is in-memory and single-instance — horizontal scaling of the
  gateway would need it externalized.
- Plugins should annotate `readOnlyHint` on their tools; unannotated tools fall back
  to the verb heuristic, which stays deny-leaning.
- The engine is provider-agnostic by construction; swapping or adding LLM providers
  touches only the factory.
