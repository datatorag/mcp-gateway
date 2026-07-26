# MCP front-door e2e harness

`apps/gateway/e2e/mcp.e2e.test.ts` is an **env-gated** end-to-end suite that
talks to a real running gateway over Streamable HTTP (`/mcp`) — no mocked DB,
no mocked auth, no mocked backend plugins. It is separate from the unit
suite (`pnpm vitest run` / `src/**/*.test.ts`) on purpose: it needs a live
process to point at, so it must never run by accident in CI or on a
contributor's machine with no such process available.

Run it with:

```bash
cd apps/gateway
pnpm test:e2e
```

With no env vars set, the whole suite reports as **skipped** and exits `0`.
This is intentional — it's the default/safe state.

## Env contract

| Var | Required for | Meaning |
|---|---|---|
| `MCP_E2E_URL` | any test to run | Base URL of the gateway, e.g. `http://localhost:<port>` (the port comes from the root `.env`'s `GATEWAY_PORT` — never hardcode it here). Unset → entire suite skips. |
| `MCP_E2E_TOKEN` | Tier 1 | A valid `Authorization: Bearer <token>` value. This must be a raw, unexpired, unrevoked row in the `oauth_access_tokens` table (see "Getting a local token" below) — the same mechanism a real MCP client gets via the gateway's OAuth flow. |
| `MCP_E2E_LIVE` | Tier 2 | Set to `1` to enable Tier 2 (read-only calls against a real connected backend service). Unset/anything else → Tier 2 is skipped. |
| `MCP_E2E_ACCOUNT` | Tier 2 | The connected-account email to pass as the `account` argument. **Tier 2 refuses to run unless BOTH `MCP_E2E_LIVE=1` and this are set** — there is no default/fallback account. |

Values are never committed. Export them in your shell before running the
script.

## The two tiers

- **Tier 1** (`MCP_E2E_URL` + `MCP_E2E_TOKEN`): initializes a session,
  confirms the built-in tools (`echo`, `list_connected_accounts`) are always
  present regardless of which plugins are installed or which services the
  caller has connected, and round-trips `echo`. This is what "the gateway
  front door works at all" means.
- **Tier 2** (also `MCP_E2E_LIVE=1` + `MCP_E2E_ACCOUNT`): calls a real
  namespaced tool (`gws-mcp__gmail_search`) against a real connected backend
  service, read-only. **Only ever point `MCP_E2E_ACCOUNT` at a
  DataToRAG-owned test account — never the founder's real work email or any
  customer/lead account.** No mutating tool call may be added to this suite
  without an explicitly reviewed, separate test that makes the mutation (and
  its cleanup) obvious in the diff.

## Reality vs. the original design sketch

The task brief's starting skeleton assumed the tool registry would always
contain "≥50 `gws-mcp__` tools" and "≥22 `atlassian-mcp__` tools." That
turned out not to hold as an invariant of the gateway itself:

- Namespaced tools are subject to "lazy tool loading" — `ListTools` filters
  out any tool whose plugin requires a connected service the calling user
  hasn't connected (`PLUGIN_SERVICE_MAP` in `service-token.ts`). A token for
  a user with zero connected accounts sees **zero** namespaced tools, in any
  environment, prod included.
- A fresh local dev DB doesn't even have the `gws-mcp`/`atlassian-mcp`
  plugins installed — only whatever test plugins were manually installed
  (e.g. a `math-tools` plugin with 2 tools, in this repo's dev DB at the time
  this suite was written).

So Tier 1 asserts what's actually invariant — `echo` and
`list_connected_accounts` always present, and any namespaced tool that IS
present follows the `serverSlug__toolName` shape — rather than
environment-specific plugin/tool counts.

## Getting a local token (no interactive OAuth required)

Obtaining a real MCP client OAuth token normally requires the interactive
`/authorize` → Google consent → `/token` PKCE flow. For local e2e testing
against your own dev database, you can bootstrap a token non-interactively
by inserting a row directly into `oauth_access_tokens` for an existing local
user — this is exactly the row the OAuth token endpoint would have created,
just written by hand instead of through the flow:

```bash
# Placeholder form — run against YOUR local dev DB, never prod.
export PGPASSWORD=localdev
TOKEN=$(openssl rand -hex 32)
USER_ID=$(psql -h localhost -p 54320 -U datatoragmcp -d datatoragmcp -tA \
  -c "select id from users where email='<your-local-dev-user-email>' limit 1;")
psql -h localhost -p 54320 -U datatoragmcp -d datatoragmcp -c "
  insert into oauth_access_tokens (token, client_id, user_id, scope, expires_at)
  values ('$TOKEN', 'e2e-test', '$USER_ID', null, now() + interval '1 day');
"

MCP_E2E_URL=http://localhost:<port-from-root-.env> MCP_E2E_TOKEN=$TOKEN pnpm test:e2e
```

Delete the row when you're done (`delete from oauth_access_tokens where
token='$TOKEN';`) — it's a throwaway local credential, not something to
leave lying around even in a local DB.

## Auth-failure mode

An invalid/expired token fails fast with a 401 from the gateway (surfaced by
the MCP SDK as a `Streamable HTTP error: ... "Invalid or expired token"`),
not a hang or timeout — useful for sanity-checking `MCP_E2E_TOKEN` before
assuming a real bug.
