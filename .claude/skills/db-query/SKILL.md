---
name: db-query
description: Use to run read-only psql queries against the DataToRAG Postgres database — local dev or production. Pulls connection details from the agent's private memory; never references infrastructure secrets in this file (it lives in a public repo). Defaults read-only; flags destructive operations.
---

# DB Query — Local + Production

Query the DataToRAG Postgres database without hard-coding any infrastructure details in this file. This skill lives in a **public repo**, so it deliberately uses placeholders and references private memory for the real values.

**Production runs on Neon serverless Postgres**, queried through the **Neon MCP** (plugin: `neon@claude-plugins-official`) — NOT via SSH into a docker Postgres on the gateway host. The old docker-on-gateway path is retired; the gateway host no longer runs the production database. Local dev still uses a docker Postgres.

## Where the actual values come from

Memory files hold the operational details:

- `reference_neon_database.md` — production Neon project id + region (query via Neon MCP)
- `reference_gateway_dev_port.md` — local dev server port (separate from DB)
- (Postgres user/database name for local dev is `datatoragmcp` / `datatoragmcp`; non-sensitive — the password is in the container's env, not this file)

If the agent doesn't have the `reference_neon_database.md` entry, run the Neon MCP's `list_projects` to find the production project (its name/id are in memory, not here), or ask the user. If the Neon MCP isn't connected, install it: `claude plugin install neon@claude-plugins-official --scope user`, then `/reload-plugins` and authenticate (OAuth).

## Local (dev)

The local Postgres runs inside the dev docker-compose stack started from `docker/`.

**1. Find the local postgres container:**

```bash
docker ps --filter 'name=postgres' --format '{{.Names}}'
```

Expected: a container name like `docker-postgres-1` or similar.

**2. Run a query:**

```bash
docker exec -it <container> psql -U datatoragmcp -d datatoragmcp -c "SELECT ..."
```

**3. Or open an interactive psql session:**

```bash
docker exec -it <container> psql -U datatoragmcp -d datatoragmcp
```

**4. Pipe multi-line SQL via stdin:**

```bash
cat <<'SQL' | docker exec -i <container> psql -U datatoragmcp -d datatoragmcp
SELECT ...
WHERE ...;
SQL
```

## Production (Neon MCP)

Production is **Neon serverless Postgres**. The project name + id live in `reference_neon_database.md` (private memory), not here. Query it through the Neon MCP tools — no SSH, no docker.

**1. Confirm the project id** (skip if you have it from memory):

```text
mcp__plugin_neon_neon__list_projects  { "search": "<project name from memory>" }
```

**2. Run read-only SQL** (defaults to the project's default branch/database):

```text
mcp__plugin_neon_neon__run_sql  { "projectId": "<id from memory>", "sql": "SELECT ... LIMIT 50;" }
```

**3. List tables / inspect a table schema:**

```text
mcp__plugin_neon_neon__get_database_tables   { "projectId": "<id>" }
mcp__plugin_neon_neon__describe_table_schema { "projectId": "<id>", "tableName": "leads" }
```

**4. Prefer to use psql directly?** Get a connection string, then run psql locally (still read-only unless confirmed):

```text
mcp__plugin_neon_neon__get_connection_string { "projectId": "<id>" }
```

> The Neon MCP is in **write mode** — destructive tools (`delete_project`, `delete_branch`, migrations) are exposed. Never invoke those, or destructive SQL, autonomously. See Safety rails below. For risky changes, test on a temporary Neon branch (`create_branch`) first.

## Safety rails

**This skill defaults read-only.** When the user asks for a query, run `SELECT` / `EXPLAIN` / `\dt` / etc. without confirmation.

**Before running any of the following on production**, explicitly confirm with the user — paste back the SQL and ask "run this on prod?":

- `INSERT`, `UPDATE`, `DELETE`
- `DROP`, `TRUNCATE`, `ALTER`
- `CREATE TABLE`, `CREATE INDEX` (migrations go through Drizzle, not ad-hoc)
- Anything wrapped in `BEGIN; ... ; COMMIT;`

For local dev, destructive ops are fine without re-confirmation as long as the user's request implies it.

**Mask sensitive output before showing the user.** When a query returns:
- Email addresses → replace with first letter + asterisks if the result will be quoted in conversation
- OAuth tokens, refresh tokens, API keys, passwords → never quote in conversation, show `<redacted>`
- Stripe IDs, customer IDs → ok to show
- User IDs (UUIDs) → ok to show

## Common query recipes

### Recent usage events

```sql
SELECT
  created_at,
  tool_name,
  connector,
  status,
  latency_ms,
  response_size_bytes
FROM usage_events
ORDER BY created_at DESC
LIMIT 25;
```

### Per-user tool-call counts (last 7 days)

```sql
SELECT
  user_id,
  count(*) AS calls,
  count(DISTINCT tool_name) AS distinct_tools,
  count(DISTINCT date_trunc('day', created_at)) AS active_days
FROM usage_events
WHERE created_at > now() - interval '7 days'
GROUP BY user_id
ORDER BY calls DESC;
```

### Daily aggregates

```sql
SELECT day, calls, p50_latency_ms, p95_latency_ms
FROM usage_events_daily
ORDER BY day DESC
LIMIT 30;
```

### Service connection status per user

```sql
SELECT
  user_id,
  service,
  account_email,
  token_expires_at,
  updated_at
FROM service_connections
WHERE token_expires_at < now() + interval '24 hours'
ORDER BY token_expires_at;
```

### Plugin / MCP server status

```sql
SELECT slug, status, container_port, build_error
FROM mcp_servers
ORDER BY slug;
```

### Tool registry — what each plugin exposes

```sql
SELECT m.slug, t.name, t.namespaced_name, t.enabled
FROM tools t
JOIN mcp_servers m ON m.id = t.mcp_server_id
WHERE m.status = 'active'
ORDER BY m.slug, t.name;
```

### Partner applications (current cohort)

```sql
SELECT email, name, role, company_name, company_size, status, created_at
FROM partner_applications
ORDER BY created_at DESC;
```

### Counting open waitlist signups (if waitlist table exists)

```sql
SELECT count(*) AS total, count(DISTINCT source_pillar) AS source_pillars
FROM waitlist_signups
WHERE created_at > now() - interval '30 days';
```

## Diagnostics: when something is off

**Connection refused (local dev):** the postgres container may not be running. `docker ps` and check status.

**Neon MCP not connected / no tools:** install with `claude plugin install neon@claude-plugins-official --scope user`, then `/reload-plugins` and authenticate (OAuth). Confirm the active org and project match the ones in `reference_neon_database.md`.

**`relation "X" does not exist`:** the table name may have been renamed or the migration hasn't run on that environment. Compare with `get_database_tables` (Neon) or `\dt` (local) to see what tables exist.

**Locked queries (waiting on lock):** check `pg_stat_activity` and `pg_locks` to see what's blocking. Don't kill prod queries without confirming with the user.

```sql
SELECT pid, now() - query_start AS duration, state, wait_event_type, query
FROM pg_stat_activity
WHERE state != 'idle'
ORDER BY duration DESC;
```
