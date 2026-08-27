# `connection_status`: a gateway built-in for "is my setup actually working"

**Status:** Design for review — not implemented. No tool is wired up by this document.
**Date:** 2026-08-27
**Ticket:** SCRUM-161 — the ticket is the record; where this document and the ticket
disagree, the ticket wins and the disagreement should be flagged, not reconciled
silently. Measured population numbers live there, deliberately not here.
**Owner:** Manuel (decision), gateway session (design)

## The problem

A user can hold an account that every surface calls "connected" while its grant covers
nothing the product does. Google's consent screen lets scopes be unticked; the gateway
stores whatever came back; and until SCRUM-136 nothing compared the two. Detection now
exists at the connect callback, on the dashboard (SCRUM-106), and inside the hosted
agent — but **an external MCP client still cannot ask the question**. A Claude Code or
claude.ai user whose tools 403 has no tool that answers "is this wired up correctly",
and neither does their agent, so the failure surfaces as a raw error on the first real
call, which is the worst possible moment.

The two tools that sound like they answer it don't:

| Surface | Tool | What it reports |
|---|---|---|
| Hosted agent (Mastra) only | `account_status` | plan, connected services, per-service grant status, run allowance |
| Gateway MCP | `list_connected_accounts` | accounts per service: email, label, is_default, connected_at — **nothing about whether the grant works** |

The gap is not "no tool exists". It is **which surface has it**: the diagnosis lives
where external users can't reach it, and the reachable tool answers a different
question (which account to address, not whether it works).

## Decision (recommended)

Add **one new gateway built-in tool, `connection_status`**, to `BUILT_IN_TOOLS` in
`apps/gateway/src/gateway/mcp-server.ts`. Not a plugin. Not an extension of
`list_connected_accounts`.

### Why not a plugin

Everything the plugin machinery provides exists to isolate third-party connector code
and external-service credentials: a child process on its own port, a git checkout with
its own install and build, Streamable HTTP transport, a per-user token forwarded as a
header, registry rows discovered from the process. This tool needs none of it — it is
a read of our own Postgres about our own rows, authenticated by the session the
gateway already resolved.

Shipping it as a plugin would buy, concretely:

- the whole plugin deploy path, including the class of failure where a build quietly
  no-ops in a persistent checkout and serves stale code while looking green;
- a registry row, tool re-discovery on change, and snapshot/classification churn;
- a token-forwarding model with no meaning here (there is no upstream credential —
  the "credential" is the session);
- an independent deploy cadence for something that must move in lockstep with the
  schema and the `scope-grant.ts` module it reads.

What we would lose by NOT making it a plugin, stated honestly: the conceptual
uniformity of "every tool is a plugin" (already deliberately broken by the two
existing built-ins), and plugin-style isolation (worthless here — there is no
third-party code to isolate). The built-in registry was built for exactly this shape:
handlers receive `{ db, userId }`, entries inherit `tool_call` emission with
`builtin: true` (classifies unmetered, never claims activation) by construction, and
`mcp-server.builtins.test.ts` iterates the registry so a new entry is test-covered
without anyone remembering to cover it.

### Why not extend `list_connected_accounts`

Two reasons, and neither is the registry:

1. **It is a shipped contract.** External agents already parse its grouped
   account-list shape, and its own description scopes its job: discover which accounts
   exist so you can pass the `account` parameter. Growing verdict fields inside that
   payload changes what existing consumers see mid-flight.
2. **It is a different question.** "Which accounts can I address" and "is my setup
   working" have different answers, different callers, and different freshness needs.
   One tool per question keeps both descriptions honest.

A correction to the working assumption that extending would force a registry resync:
built-ins have **no row in the `tools` table** — they live in code and are appended at
ListTools — so neither extending nor adding one touches the DB registry, the snapshot,
or the classification record. The reason not to extend is contract stability and
one-job-per-tool, not resync mechanics.

### One tool, not a list/diagnose/repair split

A single `connection_status` call must leave the agent's next move obvious. Splitting
diagnosis from fix-hints forces a call chain, and a partial read of that chain is
exactly how an agent confidently relays half an answer. Repair itself stays a HUMAN
act (Google's consent screen; the dashboard's default switch): this tool never
mutates, so there is no repair tool to design and no approval semantics to invent.
`list_connected_accounts` remains as-is, the addressing tool.

## Reachable exactly when it matters most

The population this tool exists for is users whose connections do NOT work — a
diagnostic that requires a working connection to run would be useless to precisely
the people who need it. So reachability with zero working connections is a design
requirement, and the built-in shape satisfies it structurally, verified against the
current dispatch code:

- **The MCP bearer is independent of service grants.** MCP access comes from the
  client OAuth flow (minimal-scope sign-in), not from any service connection. A user
  whose Google grant covers nothing — or who never connected a service at all —
  still authenticates to `/mcp` normally.
- **Built-ins bypass lazy tool loading.** ListTools filters PLUGIN tools to the
  user's connected services, then appends every built-in unconditionally. A user
  with no connections sees no plugin tools and still sees `connection_status`. This
  is also the sharpest argument against the plugin shape: a plugin's tools are
  hidden until its service is connected, so a plugin version of this tool would be
  invisible to exactly the users it diagnoses.
- **Built-ins dispatch above the billing allowance gate**, deliberately (they are
  unmetered connectivity probes and must keep answering for a capped user). A user
  who hit their call cap can still ask why nothing works.
- **The empty state is a first-class answer, not an error.** Zero connections
  returns `connected: false` per service with a `connect` fix and the connect URL —
  the same shape as every other verdict, so an agent handles "never set up" and
  "set up wrong" with the same code path.

## The payload: verdicts an agent can act on

No arguments. Identity comes from the session only — same rule as every introspection
tool: an identity parameter is an IDOR the first time a document suggests one.

```json
{
  "services": [
    {
      "service": "google-workspace",
      "connected": true,
      "usable": false,
      "why": "The default account's grant covers none of the services this connector serves.",
      "accounts": [
        {
          "email": "user@example.com",
          "is_default": true,
          "verdict": "identity_only",
          "usable_services": [],
          "missing_services": ["Gmail", "Drive", "Calendar", "Docs", "Sheets", "Slides", "Contacts", "Tasks"]
        }
      ],
      "fix": {
        "action": "reconsent",
        "url": "/auth/google/connect",
        "tell_the_user": "Reconnect Google Workspace and allow every permission on the consent screen."
      }
    },
    { "service": "atlassian", "connected": false, "usable": false, "fix": { "action": "connect", "url": "/auth/atlassian/connect" } }
  ],
  "summary": "Google Workspace is connected but not usable: the granted permissions cover none of its services. Atlassian is not connected.",
  "limitations": "Verdicts come from stored grants. A grant can look complete and still fail at call time if the token was revoked; a failing call after a green status means reconnect."
}
```

Design rules embedded in that shape:

- **`usable` is the verdict for the account calls actually run as** — the default
  account — because that binding is what broke silently before (SCRUM-145: a working
  account existed while the default was dead, and nothing said so). When the default
  is unusable but another account is usable, the service-level `why` says exactly
  that and `fix.action` is `"switch_default"` pointing at the dashboard, mirroring
  the steering the agent-surface refusal messages already use.
- **`verdict` is a closed enum:** `complete | partial | identity_only | unknown`.
  `identity_only` is a first-class state, not an edge case — it is the most common
  broken shape in production. `unknown` is for legacy rows with no stored scopes.
- **Names, never scope URLs.** `missing_services` carries the display vocabulary
  (`"Gmail"`, `"Drive"`) that `scope-grant.ts` owns. A scope URL in a tool payload is
  a string the agent will echo at a user.
- **Every not-usable state carries a `fix`** with the action, the URL, and one
  sentence the agent can relay verbatim. A diagnosis without a next step is half a
  tool; the connect URLs already exist in the service registry, and re-consent is the
  existing connect flow (it always re-prompts with the full scope set).
- **`summary` is one plain paragraph** so a lazy consumer that renders only one field
  still tells the truth.

### A deliberate divergence from enforcement: `unknown` is not `complete`

The scope-comparison module reads a null scopes value as complete, deliberately
fail-open: enforcement must never block work on rows it knows nothing about. A
**diagnostic** answering "is this working" must not launder that ignorance into
certainty. `connection_status` maps null scopes to `verdict: "unknown"` with
`usable: true` (nothing suggests it is broken) and a `why` that says the grant is not
on record. Enforcement fails open; diagnosis reports uncertainty. Both behaviors come
from the same stored value, and the difference is stated here so nobody "fixes" one
to match the other.

## Data sourcing

One query: `connected_accounts` joined to `service_connections` on
`service_connection_id`, filtered to the session user, selecting account identity
fields, `scopes`, and **derived booleans only** for token facts (`token_expires_at`
in the past; `refresh_token IS NOT NULL` computed in SQL). The token columns
themselves are never selected — a diagnostic that touches credential material is one
refactor away from leaking it into a payload.

Verdicts derive through `scope-grant.ts` (`scopeDelta`, `serviceGrantStates`,
`grantedServiceCount`) — the same single source the connect callback, the API, the
dashboard, and both call-path gates use. No second comparison is written for this
tool.

**Atlassian is covered from day one**, through the same service-generic machinery.
Its consent screen has no per-scope opt-out, so its accounts report
`verdict: "complete"` with the token-derived facts doing the useful work
(connected/absent, refresh-token presence). "Google first, Atlassian later" would
mean a second contract change for no saved effort.

## What this tool cannot tell you, and where its data comes from

Stated in the tool's own description, not just here, because implying certainty is
how a diagnostic makes things worse:

- **Stored grants are not live tokens.** A revoked or upstream-invalidated token
  looks identical to a healthy one in our rows. A grant can read `complete` and the
  first real call can still fail; the honest instruction on a green status followed
  by a failing call is "reconnect".
- **This is a derived view, not independent evidence.** The tool reads the same
  stored scopes the enforcement gates read; if that record is wrong, both are wrong
  together, in agreement. The only independent check of a connection is an actual
  tool call against the service. The description says so.
- **It performs no live probe by design.** A version that pings each provider's
  token endpoint was considered and rejected for v1: it spends quota and latency on
  every status call, turns provider blips into false "broken" verdicts (transient
  connector errors are real and must not be reported as grant failures), and uses
  tokens from a read-only diagnostic. If live probing is ever wanted, it should be a
  separate explicit argument, off by default, and it is out of scope here.

## Security and correctness invariants

- No input arguments at all; identity from the session. Same test discipline as the
  introspection tools: assert the schema stays empty of identity fields.
- Never select `access_token` / `refresh_token`; SQL-derived booleans only.
- Display names only; no scope URLs in any payload field.
- As a built-in: emits `tool_call` with `builtin: true` (unmetered, never claims
  activation) by registry construction; must NOT be added to the registry
  classification snapshot (that record is asserted against the plugin tools table,
  and a built-in entry turns the suite red).
- Note for content: published skill pages cannot name built-ins in their `tools`
  frontmatter under the current accuracy gate (it pins against the plugin registry).
  If a skill ever wants to reference this tool, that gate needs a deliberate
  extension first.

## One derivation, two surfaces

`account_status` (agent surface) and `connection_status` (MCP surface) must not
drift: two summaries of the same rows written twice is the exact derived-artifacts
trap where both go stale in agreement. Implementation should extract the per-service
grant summary both need into one shared function (natural home: next to
`serviceGrantStates` in `scope-grant.ts`, or beside `listConnectedAccounts`) and have
both tools consume it. `account_status` keeps its agent-only extras (plan, run
allowance, links); the grant verdicts come from the shared function.

## Testing plan

- The builtins suite covers dispatch/metering automatically by iterating the
  registry.
- Unit tests on the verdict mapping: identity-only (the production-common case,
  first), partial with named services, complete in Google's returned long-form
  spelling, null-scopes → `unknown` (pinning the divergence-from-enforcement rule),
  default-unusable-with-usable-alternate → `switch_default`.
- The empty state ("no connections at all") must be distinguishable from a broken
  query: the test seeds a known-present user alongside the empty case so an
  all-empty result reads as the check failing, not the world being empty.

## Out of scope, explicitly

- Any mutation (default switching, re-consent initiation). The tool points; humans act.
- Live token probes (above).
- The meta-tool migration: if the boundary ever moves to `search_tools` /
  `execute_tool`, built-ins move with ListTools and this design carries over.
- Changing `list_connected_accounts` in any way.
