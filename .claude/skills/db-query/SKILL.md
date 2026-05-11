---
name: db-query
description: Use to run read-only psql queries against the DataToRAG Postgres database — local dev or production. Pulls connection details from the agent's private memory; never references infrastructure secrets in this file (it lives in a public repo). Defaults read-only; flags destructive operations.
---

# DB Query — Local + Production

Run psql queries against the DataToRAG Postgres database without hard-coding any infrastructure details in this file. This skill lives in a **public repo**, so it deliberately uses placeholders and references private memory for the real values.

## Where the actual values come from

Three memory files hold the operational details:

- `reference_mcp_gateway_instance.md` — production host IP, SSH key path
- `reference_gateway_dev_port.md` — local dev server port (separate from DB)
- (Postgres user/database name is `datatoragmcp` / `datatoragmcp` in both environments; this is non-sensitive — the password is in the container's env, not this file)

If the agent doesn't have these memory entries, stop and ask the user before guessing.

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

## Production

Production Postgres also runs inside docker-compose on the gateway host. Same psql commands, but reach the container via SSH first.

**1. SSH in:**

```bash
ssh -i <ssh-key-from-memory> -o StrictHostKeyChecking=no ubuntu@<host-from-memory>
```

The flag combination matches the patterns used by the `deploy` skill in this repo.

**2. Then locate the postgres container and query — same as local:**

```bash
docker ps --filter 'name=postgres' --format '{{.Names}}'
docker exec docker-postgres-1 psql -U datatoragmcp -d datatoragmcp -c "SELECT ..."
```

**3. One-liner pattern (run query without an interactive shell):**

```bash
ssh -i <ssh-key> ubuntu@<host> \
  "docker exec docker-postgres-1 psql -U datatoragmcp -d datatoragmcp -c \"SELECT count(*) FROM users;\""
```

**4. Multi-line SQL piped in:**

```bash
cat <<'SQL' | ssh -i <ssh-key> ubuntu@<host> \
  "docker exec -i docker-postgres-1 psql -U datatoragmcp -d datatoragmcp"
SELECT ...
WHERE ...;
SQL
```

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

**Connection refused:** the postgres container may not be running. `docker ps` and check status.

**Permission denied (publickey) on SSH:** confirm the SSH key path from memory and that the key file has `chmod 600`.

**`relation "X" does not exist`:** the table name may have been renamed or the migration hasn't run on that environment. Compare with `\dt` to see what tables exist.

**Locked queries (waiting on lock):** check `pg_stat_activity` and `pg_locks` to see what's blocking. Don't kill prod queries without confirming with the user.

```sql
SELECT pid, now() - query_start AS duration, state, wait_event_type, query
FROM pg_stat_activity
WHERE state != 'idle'
ORDER BY duration DESC;
```
