---
name: ops-debugging
description: Use when diagnosing or operating the datatorag-mcp production gateway — plugin update/re-discovery, OAuth token failures, container issues, health checks. Placeholder-form runbook; live values come from private memory (like db-query).
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

This skill only adds what those don't cover: the full plugin re-discovery
recipe (deploy skill stops at "see reference_plugin_registry for details"),
a symptom-first failure-mode table, and verification patterns that combine
health checks + DB state.

## Plugin update + tool re-discovery

When a plugin's tool set changes (new/renamed/removed tools) and a rebuild alone
won't fix the `tools` table, run the full re-discovery recipe. Proven in prod
2026-07-18.

1. **Pull + build the plugin inside its running container** (see deploy skill
   step 5 for the `git pull && pnpm install && npx tsc` exec).
2. **Restart the gateway** so the plugin child process picks up the new build.
3. **Run a re-discovery script from inside the gateway container** — it must
   execute from `/app/apps/gateway` (module resolution for `@modelcontextprotocol/sdk`
   and the `postgres` driver fails from `/tmp` or other paths):

   ```bash
   docker exec -i <gateway-container> bash -c \
     'cat > /app/apps/gateway/rediscover.mjs && cd /app/apps/gateway && node rediscover.mjs; rm -f /app/apps/gateway/rediscover.mjs' < rediscover.mjs
   ```

   The script file must live under `/app/apps/gateway` — Node ESM resolves imports from the script's own path, so `/tmp` fails even with `cwd` set. The script is piped in from your local copy and removed after.

   Script skeleton (fill in `<placeholders>`):

   ```js
   import { Client } from "@modelcontextprotocol/sdk/client/index.js";
   import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
   import postgres from "postgres";

   const PLUGIN_PORT = <plugin-port>;       // from mcp_servers.container_port
   const MCP_SERVER_ID = "<mcp-server-uuid>";
   const SLUG = "<plugin-slug>";
   const sql = postgres(process.env.DATABASE_URL); // container's own env, no secrets here

   const transport = new StreamableHTTPClientTransport(
     new URL(`http://localhost:${PLUGIN_PORT}/mcp`)
   );
   const client = new Client({ name: "rediscover", version: "1.0.0" }, { capabilities: {} });
   await client.connect(transport);
   const { tools } = await client.listTools();

   await sql`DELETE FROM tools WHERE mcp_server_id = ${MCP_SERVER_ID}`;
   for (const t of tools) {
     await sql`INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, credits_per_call)
       VALUES (${MCP_SERVER_ID}, ${t.name}, ${`${SLUG}__${t.name}`}, ${t.description}, ${JSON.stringify(t.inputSchema)}, 1)`;
     // enabled column defaults to true; no need to set it explicitly
   }
   await sql.end();
   ```

4. **Restart the gateway again** (compose `restart gateway` per deploy skill) so
   any in-memory tool-list caches pick up the new rows.
5. **Note the side effect**: MCP client sessions are held in-memory only
   (see gateway boot behavior) — every restart in this recipe drops all live
   MCP sessions. This is expected; connected clients simply re-initialize and
   users re-auth on their next tool call. Don't treat it as a regression.
6. **Verify** — see Verification patterns below.

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
  (same Streamable HTTP call used in the re-discovery script above) against
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
