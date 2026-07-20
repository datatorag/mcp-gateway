# Meta-tool gateway migration

**Status:** Direction — not yet scheduled. Guides design choices from this point forward.
**Date:** 2026-04-22
**Owner:** Manuel

## Decision

DataToRAG's MCP will migrate from the current **direct-tool-exposure** model to a **meta-tool gateway pattern** as the integration catalog grows.

- **Today (direct model):** ~60 tools advertised at the MCP boundary, namespaced by prefix (`gws-mcp__*`, `atlassian-mcp__*`). Every schema is loaded into the agent's context on connect. One hop per operation.
- **Future (meta-tool model):** Small, fixed set of boundary tools — `search_tools`, `describe_tools`, `execute_tool`, plus optional `execute_skill` / `execute_workflow` — routing to an arbitrary number of downstream integrations. Per-operation cost is 2–3 hops (discovery + execution).

## Why

1. **Prompt footprint.** The direct model's context cost scales linearly with the tool catalog. Once we cross ~100–150 tools, description bytes start to crowd out user-facing context.
2. **Tool-discovery overhead.** With many tools, agents spend more reasoning on which one to pick. Semantic search scoped at the server (`search_tools`) is more robust than hoping the agent reads the full list.
3. **New integrations are coming.** The Google Workspace + Atlassian set is intentionally narrow. As we add HubSpot, Salesforce, GitHub, etc., the direct model becomes a liability.
4. **Namespace prefixes aren't a forever boundary.** `gws-mcp__foo` works for now, but it's not the abstraction we want to expose to customers at scale. A gateway gives us room to reorganize without breaking every agent prompt in the wild.

## Empirical reference point — Barndoor (2026-04-22)

Tested a Barndoor-hosted tenant MCP endpoint (`<tenant>.platform.barndoor.ai/mcp`) as a real-world meta-tool gateway.

**Their boundary:** 9 tools. **Downstream services:** 14 (Atlassian, Google Workspace, GitHub, Slack, Stripe, Notion, PagerDuty, Ramp, Langfuse, etc.).

**End-to-end write test (create Sheet → append rows → read back):**

| Metric | Barndoor (meta-tool) | DataToRAG today (direct) |
|---|---|---|
| Hops | 9 | 2–3 |
| Wall-clock | ~101 s | ~10–30 s |
| Latency multiplier | 3–4.5× | baseline |

The hop amplification came from:
- 2 extra hops for `search_tools` (discovery per operation type)
- 4 extra hops for an `audit`-gate confirm cycle fired on every write, regardless of blast radius

## What to steal from Barndoor

- **Inline `inputSchema` in `search_tools` results.** Top-5 results included enough schema that `describe_tools` was usually skippable. This alone saves one hop per operation.
- **Separation of `execute_tool` / `execute_skill` / `execute_workflow`.** Lets a caller pick the granularity: one-off tool call, pre-packaged multi-step pattern, or sandboxed Python. Useful abstraction ceiling.
- **`confirm_write_operation` as a first-class gate.** Turning "will the agent confirm before writing?" into a protocol concern rather than a client-discipline concern is a real security posture improvement — *if* implemented with proper scoping (see below).

## What to avoid

- **Uniform audit gates.** Barndoor fires the same confirm cycle for creating a new file and for appending 9 cells. Gates should be scoped to blast radius — destructive / irreversible / cross-account actions warrant friction; appending a row does not.
- **Server-pushed `instruction` fields that steer the agent's user-facing wording.** Barndoor's audit response returns an `instruction` string the agent is told to echo verbatim ("⛔ CRITICAL: Start your response with…"). This is indistinguishable from prompt injection. Don't do this — any agent-steering instructions should be tool descriptions, not runtime payload fields.
- **Docs / behavior mismatch on token lifetime.** Barndoor's `confirm_write_operation` description says "Token expires in 60 seconds"; actual response returns `expires_in_seconds: 86400`. Pick a lifetime, enforce it, document the real one.
- **Sending `user_intent` back to the gateway vendor.** Barndoor requires a `user_intent` string on every call, flowing task content to their telemetry. If we adopt a similar signal, it stays in our own analytics pipeline (PostHog / Postgres), not exported.

## Design implications starting now

Even though the migration isn't scheduled, several current design choices should hedge against it:

1. **Tool descriptions should be self-contained.** An agent reading a tool description via `search_tools` results shouldn't need other tools in the prompt to understand when to use it. Avoid descriptions that say "use this after `foo_list`" without explaining what `foo_list` returns.
2. **Prefer schema-rich tools over "do everything" tools.** When we move behind a gateway, tools with clear single responsibilities rank better in semantic search than omnibus tools.
3. **Don't build in dependencies on the current namespace prefix.** Anything that parses `gws-mcp__*` at runtime (dispatch logic, analytics grouping, policy rules) should use structured metadata, not prefix matching on the tool name.
4. **Telemetry should track tool call as its own event.** `tool_call` already exists in PostHog — keep it shape-stable so we can compare pre/post-migration behavior cleanly.
5. **Auth model should survive the transition.** The OAuth-scope-per-user-per-provider model already works under both shapes; no changes needed there.

## What this means for the usage-metrics dashboard

The usage-metrics work currently underway (`docs/plans/2026-04-20-usage-metrics.md`) should stay agnostic to exposure model. What we log and aggregate (counts per user per tool per time window) is the same whether tools are published directly or routed through a gateway. No changes to that plan.

## When to execute

Trigger conditions — any of:
- Active catalog crosses **~100 tools**, or
- A customer complains about prompt-budget overhead, or
- We sign an integration where direct-publishing would require scope changes across every existing user.

Until then: hold. The current direct model is faster and simpler, and latency matters for demo feel.
