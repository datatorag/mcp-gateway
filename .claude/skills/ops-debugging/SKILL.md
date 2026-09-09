---
name: ops-debugging
description: Use when diagnosing or operating the datatorag-mcp production gateway — plugin update/registry change, OAuth token failures, container issues, health checks. Placeholder-form runbook; live values come from private memory (like db-query).
---

# Ops Debugging — Production Gateway

Diagnose and operate the production gateway without hard-coding any infrastructure
details in this file. This skill lives in a **public repo**; live values (host,
SSH key, ports beyond what's already public in the compose files, profile names)
come from private memory or the deploy/db-query skills, never from here.

## Sources of truth

Don't duplicate these — read them first, then come back here for the gap:

- **Deploy skill** (`.claude/skills/deploy/SKILL.md`) — SSH access, `.env` render
  step, rebuild command, health-check curl, plugin reinstall exec, log-tailing,
  its own 5-item Troubleshooting section.
- **db-query skill** (`.claude/skills/db-query/SKILL.md`) — how to query prod
  (Neon, via Neon MCP) vs local dev (docker exec psql), safety rails, canned
  recipes including the tool-registry query.
- **Memory refs** for live values: `reference_mcp_gateway_instance` (host/region),
  `reference_plugin_registry` (installed plugins, reinstall notes),
  `reference_neon_database` (prod project id/region).

This skill only adds what those don't cover: the plugin update + registry
change recipe (and why it is never a re-discovery),
a symptom-first failure-mode table, and verification patterns that combine
health checks + DB state.

## Plugin update + registry change

When a plugin ships a change to its tool set (a changed description or schema,
a new tool, a removed tool), the container gets the new code and the `tools`
table gets exactly the rows that changed. Not a re-discovery.

**The registry rule (SCRUM-138, SCRUM-235).** The `tools` table does not
resync itself on a plugin deploy: `startAll()` only respawns processes, and
`discoverTools()` runs at install time only. It is also never regenerated
wholesale by hand. A full re-discovery (delete every row, reinsert what the
plugin reports) once left seven tools live in the plugin and invisible in the
registry, and its unconditional DELETE is the wrong tool for every routine
change. What to do instead depends on what changed:

- **An existing tool changed** (description, input schema, annotations): one
  surgical `UPDATE tools SET description = ..., input_schema_json = ...
  WHERE namespaced_name = '<slug>__<tool>'`, guarded on the old description
  text so it touches nothing if the row is not the one you expect, with
  `RETURNING` read back. The served count stays flat; say so in the report.
- **A new tool**: one `INSERT` for that row (columns as `discoverTools`
  writes them: `mcp_server_id`, `name`, `namespaced_name`, `description`,
  `input_schema_json`, `read_only_hint`, `credits_per_call`), landed in the
  same change as the playground classification commit. The served count
  moves by exactly one, and the smoke suite is told in advance so its count
  assertion is updated, not surprised.
- **A removed tool**: one `DELETE` of that row, same discipline.
- **Never a full re-discovery.** If the registry and the plugin disagree by
  more than the change you are shipping, stop and diff them; a wholesale
  rewrite hides the discrepancy instead of explaining it.

After the row change, verify against the served surface, not the plugin's
source: `tools/list` through the gateway with a real bearer must show the
new description or the new name.

1. **Pull + build the plugin inside its running container** (see deploy skill
   step 5 for the `git pull && pnpm install && npx tsc` exec).
2. **Restart the gateway** so the plugin child process picks up the new build.
3. **Apply the row change** from a session that can reach the production
   database (the `db-query` skill), one statement, read back with
   `RETURNING`. For an `INSERT`, `read_only_hint` is not optional: the
   cross-check in `tool-classification.test.ts` treats NULL as "the plugin
   said nothing", so a row written without it disables the guard rather than
   tripping it. Match `discoverTools` in `plugin-manager.ts` column for
   column. (The retired wholesale script lived here until SCRUM-235; it is
   gone on purpose, and the unconditional DELETE it carried is the reason.)
4. **No gateway restart is needed for the registry.** `listUserToolRows`
   (`user-tools.ts`) queries `tools` on every ListTools request and caches
   nothing, so new rows are live to the next request from any session, old or
   new. An earlier version of this step prescribed a second restart "so
   in-memory tool-list caches pick up the new rows" — there is no such cache.
   That mattered: the restart is what made this procedure feel expensive enough
   to skip, and skipping it is how a tool ships into the container and never
   reaches the registry. (Step 2's restart is still required — that one is for
   the plugin child process to pick up new *code*.)
5. **Note the side effect** of step 2's restart: MCP client sessions are held
   in-memory only (see gateway boot behavior), so it drops all live MCP
   sessions. This is expected; connected clients simply re-initialize and users
   re-auth on their next tool call. Don't treat it as a regression.
6. **Verify against the plugin, not against the registry** — see the
   registration-verification leg below. This step is mandatory at rollout.

## Registration verification (mandatory at every rollout)

**Run this at rollout, not only when something looks wrong.** A tool can ship
into the plugin container and never reach the registry, and nothing anywhere
goes red.

### Why the obvious checks cannot catch it

The gateway serves `tools/list` from the **registry**, not from the plugin
(`mcp-server.ts` → `listUserToolRows`). So an unregistered tool is invisible to
every client, fresh or stale, and reconnecting cannot reveal it. Worse, the two
checks people reach for first are both **derived from the registry**:

- the `tools` table row count, and
- the repo's `registry-snapshot.ts`.

They are two views of one source. They agree with each other while both
disagree with the plugin, so the drift reads as consensus. That is the whole
trap: the more places you check, the more confident you get, and none of them
is ground truth.

Nor does "the deploy worked" prove registration. A bundled behaviour fix in the
same rollout can be live and verifiable — proving the container did update —
while the tool set silently did not. Code shipping and the registry learning
are two events, and only one of them has a check.

### The only leg that compares against ground truth

Ask the **plugin** what it has, and diff that against the registry:

```js
// Run from /app/apps/gateway inside the gateway container (module resolution
// for the SDK and the postgres driver fails from /tmp). Read-only: it never
// writes to `tools`.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import postgres from "postgres";
const PLUGIN_PORT = <plugin-port>;       // from mcp_servers.container_port
const MCP_SERVER_ID = "<mcp-server-uuid>";
const sql = postgres(process.env.DATABASE_URL); // container's own env
const client = new Client({ name: "verify", version: "1.0.0" }, { capabilities: {} });
await client.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${PLUGIN_PORT}/mcp`)));
const { tools } = await client.listTools();
const rows = await sql`
  SELECT name FROM tools WHERE mcp_server_id = ${MCP_SERVER_ID} AND enabled = true`;

const live = new Set(tools.map((t) => t.name));
const registered = new Set(rows.map((r) => r.name));
console.log({
  unregistered: [...live].filter((n) => !registered.has(n)).sort(),  // shipped, invisible
  stale:        [...registered].filter((n) => !live.has(n)).sort(),  // advertised, gone
});
```

Both directions matter. `unregistered` is a capability nobody can reach;
`stale` is a tool we advertise that the plugin no longer implements, which
fails at call time after someone has planned around it.

This leg keeps getting skipped because the container has no `PLUGIN_MCP_URLS`
set, so it has to be run by hand from inside the gateway container. **Getting
that variable into the container is the durable fix** — until it is there, this
check depends on someone remembering, which is exactly what failed. Until then,
run it by hand and treat it as part of the rollout, not as debugging.

### Then confirm from a fresh session

After the registry agrees with the plugin, connect a **fresh** MCP session and
confirm the new tool appears in `tools/list`. Fresh matters only for the
client's own cached tool list — the gateway itself has no cache — but it is the
step that proves the whole chain end to end, from plugin to registry to a real
client, and it is cheap.

Finish with the tool's own acceptance case (for a destructive tool: create a
throwaway object, act on it, verify it is gone), so registration is proved by
use rather than by a row count.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| GWS tool calls fail with generic "Error occurred during tool execution" | User's `service_connections` row missing, or token expired and refresh failed | → deploy skill Troubleshooting ("GWS MCP tools load but all API calls fail"); run the check via the db-query skill's service-connection recipe |
| Plugin fails to start, `ENOENT` for a binary | Binary-download step missing from the image or build chain | → deploy skill Troubleshooting ("GWS binary not found") + the gws-mcp-dev skill's build-chain gotcha |
| `db-init` container exits with a Postgres auth error | `--env-file ../.env` not passed to prod compose (`POSTGRES_PASSWORD` resolves empty; dev compose hardcodes a local password, so this is prod-only) | → deploy skill Troubleshooting ("db-init fails") |
| MCP tool calls fail right after a gateway restart/deploy | Sessions are in-memory only; restart drops all live MCP sessions | Expected — instruct the client to re-initialize; user re-auths on next use, no data lost |
| Gateway container up but requests fail / healthcheck red | Boot-time `getEnv()` Zod validation can exit the process before the listener opens (commonly a malformed `DATABASE_URL`), or Postgres wasn't ready when a decoupled `gateway` service started | Check container logs first (see deploy skill); look for a Zod validation dump near the top of the log, not just the latest lines |
| `GET /api/servers` returns `{"error":"Unauthorized"}` | Public plugin-management endpoints were removed (commit `7fb0356`) | Don't use it for status checks — query `mcp_servers`/`tools` directly via the db-query skill instead |

## Verification patterns

- **Health endpoint** (liveness only, no DB check): use the deploy skill's
  health-check curl. A 200 here does not prove DB connectivity — pair it with
  a DB check below.
- **Container state vs crash-loop**: `docker compose ... ps` shows whether a
  service is `running (healthy)`, `running (unhealthy)`, or restarting in a
  loop — check this before assuming "won't start" means the same thing as
  "started but every DB-touching route fails" (these have different fixes;
  see deploy skill's `a4e56b3` note that prod `gateway` has no `depends_on`
  on postgres/db-init).
- **Tool-count parity**: compare the plugin's live `tools/list` response
  (the Streamable HTTP connect in the registration-verification leg above) against
  the `tools` table row count for that `mcp_server_id` — use the "Tool
  registry" recipe in the db-query skill.
- **Plugin/server status**: the db-query skill's "Plugin / MCP server status"
  recipe (`mcp_servers` — `status`, `build_error`) is the fastest way to see
  if a plugin build failed without touching the removed public endpoint.
- **Cron jobs**: the three in-process `node-cron` jobs (rollup, Slack digest,
  no-activation email) each just log-and-continue on failure — a silent
  failure won't crash the gateway, so check container logs around the
  scheduled time if a downstream effect (e.g. a missing digest message) is
  reported missing, rather than assuming the process is unhealthy.
