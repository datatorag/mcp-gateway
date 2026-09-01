# SCRUM-188: the dashboard agent becomes an ordinary client of our own MCP

**Status:** Spec for review — no implementation in this change.
**Date:** 2026-08-31
**Ticket:** SCRUM-188 (the pinned settled-design comment is the ruling record;
this document is the implementation design against it). Ruled by Manuel: the
agent is another client of our MCP, already authenticated because the user
already logged in. That ruling is not reopened here.

## The cost stated first, because it is the honest lead

The one place this ruling is expensive: **`tool_call.run_id` goes dark until
SCRUM-189.** Today the agent's metering layer stamps the run id on every tool
event, which is the only join between "what a run cost" and "what tools it
used". Under this design the agent layer emits nothing — the one event comes
from the MCP layer, which has no run in scope — so that join is null for agent
traffic until client identity (SCRUM-189) carries it. Recommendation:
land SCRUM-189 in the same cutover, or accept a stated window where per-run
tool attribution does not exist. This is a loss to schedule around, not a
reason to reopen the ruling.

Second cost, smaller: the cutover is a **metric-era boundary**. Every agent
tool call re-labels from `surface: "agent"` to `surface: "mcp"` at the moment
of deploy, so any chart split by surface, and the activation cohort filtered
by it, steps discontinuously. The deploy record should say so.

## Mechanism: an in-process client, per request

The agent stops resolving plugin tools itself. Per chat request:

1. Construct the pair in-process:
   `createMcpServer(userId, db, pool, opts)` — the same constructor
   `server.ts` uses at its `/mcp` route, with the session's userId the
   dashboard already holds — connected to an SDK `Client` over
   `InMemoryTransport.createLinkedPair()` (already exercised by the
   mcp-server test suites). The client's `clientInfo.name` is
   `"datatorag-agent"`: the agent genuinely is a client, so it says which.
2. `client.listTools()` returns exactly what any MCP client sees: the
   connected-service-filtered plugin tools under their namespaced names, plus
   the built-ins. One tool surface, one filter policy, by construction.
3. Each listed tool is wrapped into the agent runtime's tool shape: `execute`
   forwards to `client.callTool`, and `requireApproval` is set at wrap time
   (next section). The prompt-cache breakpoint treatment stays agent-side,
   unchanged.

No token loading, no per-server token/scope threading, no client cache, no
account-argument stripping in the agent layer: the MCP server resolves the
per-call token, account, and scope gate itself, as it does for every client.
Per-request construction replaces the memoized per-user client cache; the
in-process server holds no state worth caching and the registry read it does
per turn is the read the old path did per turn anyway.

Facts this stands on, re-verified in this change rather than inherited: one
Express process serves both `/mcp` and the dashboard; `createMcpServer` takes
a userId, not a token; the dashboard request context carries that userId.

## The write-approval design (the one real piece of engineering)

The policy already lives gateway-side (`classifyWrite`,
`src/gateway/playground/tools.ts`) and its contract is name-based and
runtime-independent. What moves is only the wiring:

- **The wrapper applies `classifyWrite(namespacedName)` to every tool it
  wraps, at wrap time.** Same call the old path made, same fail-closed
  default: a name the classifier does not recognise requires approval. There
  is no path that puts a tool in front of the model without passing through
  the wrapper, which is the property that makes the gate a gate.
- **Built-ins need a classification home, and it must not touch the plugin
  snapshot.** The registry snapshot and `KNOWN_READ_TOOLS` are pinned against
  the live plugin registry by tests that fail in both directions; adding
  built-in names there turns those suites red by design. Instead:
  `BUILT_IN_TOOLS` entries gain a declared `approval` field (read/write) in
  the same registry object — the same declared-not-classified discipline the
  introspection tools use today, in the same file a new built-in is added to,
  so classification cannot be forgotten separately from creation. The wrapper
  consults the declaration for built-in names before falling back to
  `classifyWrite`. A parity test iterates `BUILT_IN_TOOLS` and asserts every
  entry declares its approval requirement (coverage by construction, the same
  trick the metering tests use).
- **The security test that matters:** a suite that lists tools through the
  real in-process pair and asserts (a) every write-classified plugin tool
  arrives with `requireApproval: true`, (b) both built-ins arrive with their
  declared value, (c) an unrecognised name arrives requiring approval. That
  is the "a write cannot reach the model unguarded" pin, asserted at the
  boundary the model actually sees.

## The four introspection tools

- **`account_status`: deleted.** It is the older copy of "what am I connected
  to", it collapses accounts and mislabels default-account scope status as
  the service's, and `list_connected_accounts` — which the agent now sees
  through the endpoint — replaces the account listing outright. Its
  agent-only extras (plan, runs remaining, links) are UI facts, not account
  facts; they move nowhere in this change, and if the agent needs them later
  they belong in a UI-side tool that does not duplicate connection data.
  (The two data defects in the ticket description ship first and
  independently per the ruling; this deletion then removes the surface they
  lived on.)
- **`request_connection`: stays.** It writes a UI part into the stream and
  steers the connect flow; it is an agent-UI action, deliberately outside the
  registry, and no MCP client concept replaces it.
- **`disconnect_service`: stays.** Declared-approval account mutation with a
  confirm card; same reasoning.
- **`show_mcp_config`: stays.** Server-enforced gating of a proactive UI
  offer; same reasoning.

These three remain agent-side Mastra tools merged after the wrapped MCP set,
exactly as today, and remain excluded from the registry snapshot.

## Metering and analytics

- **The agent layer's entire metering path is deleted**, not reduced: the
  meter threading, the per-call report, the account stamping. One tool call
  is one event, emitted by the MCP layer's existing `trackToolCall`.
- **Consequences, named rather than implied:**
  - `surface` reads `"mcp"` for agent calls; it stops discriminating, by
    design. Client identity on the event is the replacement (SCRUM-189,
    dependency noted, not built here).
  - `run_id` on tool events: dark until SCRUM-189 (the lead cost above).
  - The free-tier hard stop (`checkCallAllowance`) now gates agent tool
    calls before dispatch, because it gates every client's calls. That is a
    behavior change and the correct one under "a tool call is a tool call".
  - Activation claiming is unchanged mechanically (the MCP layer's event
    path already claims it for real plugin tools on success).
  - Built-ins stay unmetered and non-activating by their existing registry
    construction.
- **Session events:** the in-process transport never crosses the HTTP layer,
  so `mcp_request_received` / `mcp_session_initialized` — emitted there — do
  not fire for agent sessions. This spec deliberately does NOT add an
  agent-side imitation of them: provenance gets one mechanism (SCRUM-189 on
  the tool event), not two. Until then, agent sessions are visible through
  their tool events and the playground's own event track, which is unchanged.

## Scope-refusal wording keeps its steering

The MCP server's pre-call scope gate refuses with a message pointing at the
dashboard URL, because an external client can render nothing else. The agent
CAN render the inline reconnect card, and its current refusal message steers
the model to `request_connection`. To keep that without re-adding an
agent-side gate: `createMcpServer` opts gain a wording hint (the existing
`missingScopeMessage` already takes a surface argument), set only by the
in-process construction. One policy, one gate, one message function; the
constructor's caller states which audience it serves.

## What dissolves in the agent client

Deleted outright from `src/mastra/mcp/client.ts`: the per-user MCP client
cache with its sweep and token fingerprint, credential loading and the
token/scope/account context threading, the agent-side scope pre-check and 403
rewrite (the server's own gate now serves the agent), account-argument
stripping, and the metering wrapper. What remains agent-side: the in-process
pair construction, the approval wrapper, the cache-breakpoint treatment, and
the three surviving introspection tools.

Test suites whose contract this changes, to be moved or retired with stated
reasons rather than silently edited: the agent tool-metering suite (documents
the deleted double-emission path; replaced by a test asserting the agent
layer emits nothing), the agent-side scope-gate suite (its policy assertions
move to the server-side gate where they now execute), and the write-gate
suite (retargeted at the wrapper).

## Deliberately not done here

- SCRUM-190 (revoked grants indistinguishable from live): shares a surface,
  explicitly out of scope.
- The Connections page: untouched; it is the correct implementation.

## Amendment, 2026-09-01: what moved when the code was written

Implemented at the go, with SCRUM-189 BUNDLED (ruled: shipping it
separately would buy a second metric-era discontinuity in the same
charts — one break, not two). Two spec lines were overtaken, and where the
code disagreed with the spec, the code won:

- **"The two account_status data defects ship first, independently" is
  WITHDRAWN.** That sequencing predated the settled design; both defects
  lived only in account_status, and the deletion IS the fix. Nothing was
  patched on the way to being deleted.
- **The `account` argument now travels THROUGH the agent.** The spec noted
  the old path stripped it; implementation makes the inversion explicit: an
  MCP client forwards the argument and the server resolves it — which is
  what makes multi-account addressing work from the agent at all. The
  server only resolves accounts belonging to the session user, so
  forwarding is not a confused-deputy path. Pinned by the write-gate suite.
- **SCRUM-189 needed no invention:** client_name is `datatorag-agent` (the
  in-process client's own clientInfo, read server-side from the initialize
  handshake); client_id is `web`, the OAuth client id the dashboard
  session's tokens already carry. Confirmed while wiring it: the dynamic
  registration endpoint mints a fresh id per registration with no dedupe,
  so **client_id identifies a REGISTRATION, not a product** — client_name
  is the product-ish axis (self-reported, drifts), client_id the stable
  one. Breakdowns should anchor on name. Rows from before these fields
  existed have neither; that cliff is a missing join key, not a usage drop.
- **run_id on tool events is not preserved**, per the implementation-go
  ruling: agent traffic is a small fraction of all tool calls and no
  machinery is built to carry a run through the MCP layer. If SCRUM-189's
  fields later offer a cheap per-run attribution path, that is a separate
  change.
- **The runtime accepts the wrapped shape directly:** MCP JSON schemas pass
  through the `ai` package's `jsonSchema()` wrapper on plain tool objects,
  and the approval flag on those objects is honoured by the real confirm
  flow — proven end-to-end by the retargeted write-gate suite, including a
  deliberate-sabotage run showing five tests go red when the gate is
  removed. A security pin nobody has seen fail is decoration; this one has
  been seen failing.
- **Built-ins declare `approval: "read" | "write"`** on their registry
  entries as designed; the parity pin and the boundary suite (wrapped
  tools, both built-ins, the fail-closed stranger, and the three
  wrapper-bypassing UI tools) live in `mastra/mcp/client.test.ts`.
