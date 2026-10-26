# Provider refresh failures become a recorded fact (SCRUM-190, SCRUM-164)

Status: spec, written from the code at `2c5be1b`. Nothing here is built until a go. Not
user-visible in this step; no changelog entry.

Two tickets, one signal. When a provider refuses to refresh a connection's token, it says why,
and today that answer is dropped. The user then reads a sentence that is false ("No connected
account found for ..."), the connections screen keeps showing the account as connected, and a
user who is trying and failing looks exactly like a user who stopped trying.

## What happens today

**The refresh functions** in `gateway/service-token.ts`:

| Function | On a refused refresh | On a thrown fetch |
|---|---|---|
| `refreshGoogleToken` | `if (!res.ok) return null`, reason discarded | `catch { return null }` |
| `refreshAtlassianToken` | `if (!res.ok) return null`, reason discarded | `catch { return null }` |
| `refreshNotionToken` | reads the body: `invalid_grant` becomes `{ rejected: true }`, anything else `{ failed: true }`; a rejection re-reads the locked row before giving up and logs one line | `catch { return null }` |

All three return `string | null` through `REFRESH_FN`, so every failure reaches
`resolveServiceToken` as the same `null`: a revoked grant, a wrong client secret, a 429, a 500
and a network timeout are indistinguishable. Notion rows store no expiry, so its refresh does not
run on any call path today; it is included so it keeps the same contract when it does.

**`resolveServiceToken`** (since SCRUM-442 release 2 it reads and opens the sealed columns)
calls `REFRESH_FN[service]` only when `token_expires_at` has passed and a refresh token exists,
and returns `null` when the refresh returns `null`. Its callers:

- `mcp-server.ts` CallTool: a `null` becomes `No connected account found for <account>. Please
  connect it ...` when the caller named an account, otherwise `<Service> is not connected.
  Please connect it ...`. Both are false for a connected account whose refresh failed.
- `playground/tools.ts` (`getServiceToken`, the connections page's tool tester) and
  `file-source.ts` (a file reference's source read): both treat `null` as "no token".

`connectionFailureService` in `mcp-server.ts` recognises those two sentences (and the scope
refusal) so the skill scheduler can pause a schedule with "reconnect needed". Any change to the
wording changes that recogniser in the same file.

**The event the brief names is taken.** `OAUTH_REFRESH_EXPIRED` (`oauth_refresh_expired`) fires
in `gateway/oauth/token.ts` when an MCP CLIENT presents an expired refresh token to the gateway's
own token endpoint. It is about our grant to Claude or Cursor, not a provider's grant to us. There
is no event for a provider refresh at all, succeeded or failed: `oauth_refresh_succeeded` is also
the gateway's own endpoint. See Decision 1.

**The row** (`packages/db/src/schema/service-connections.ts`) holds tokens, scopes,
`token_expires_at`, `connected_at` and `updated_at`. `updated_at` moves on every successful
refresh and on reconnect; nothing records a failed one.

**What the user and the model see.** `list_connected_accounts` (the built-in the model uses to
check accounts; there is no `account_status` tool) lists each account with its granted services,
from stored scopes. The connections screen reads `loadConnectionsView` (`gateway/connections-view.ts`,
behind `/api/connections`), also from stored scopes. Neither can know a grant is dead.

## The design

### 1. Classify the failure where it happens

One function in `service-token.ts`, used by all three refreshes:

```
type RefreshFailure = {
  kind: "permanent" | "transient";
  /** A short code, never the response body: invalid_grant, invalid_client,
   *  unauthorized_client, http_429, http_5xx, network, timeout, unexpected. */
  reason: string;
};

function classifyRefreshFailure(status: number | null, body: unknown): RefreshFailure
```

| Signal | Kind | Reason |
|---|---|---|
| 400 or 401 with OAuth `error` `invalid_grant` | permanent | `invalid_grant` |
| `invalid_client`, `unauthorized_client` | permanent | as given |
| 429 | transient | `http_429` |
| 5xx | transient | `http_5xx` |
| fetch threw, or aborted on timeout | transient | `network`, `timeout` |
| any other 4xx, or a body that does not parse | transient | `unexpected` |

Only the OAuth `error` field is read from the body. Its `error_description` and everything else
are not stored or logged, because a provider can echo request detail there.

The stored reason is always one of the fixed codes above, never the provider's `error` string
written through: `invalid_client` and `unauthorized_client` are matched exactly, and any other
`error` value maps to `unexpected`. A classifier test feeds an unknown `error` value and asserts
`unexpected` is what is stored and what `/api/connections` shows.

An `unexpected` answer is transient on purpose. A connection is only ever called dead on a reason
we know means "re-consent required". Calling an unknown answer dead would send a user through a
consent flow they did not need, which is a worse error than the silence it replaces.

The refresh functions return `{ token } | { failure: RefreshFailure }` instead of
`string | null`. Missing client credentials (`clientId` or `clientSecret` unset) stays a separate
case: a deployment fault, not a fact about the user's grant, and it records nothing on the row.

### 2. Record it on the connection

A migration adds three columns to `service_connections`:

| Column | Type | Written |
|---|---|---|
| `last_refresh_at` | `timestamptz` | on every refresh attempt, success or failure |
| `last_refresh_error` | `text` | the reason code on failure, `NULL` on success |
| `refresh_permanent_failures` | `integer not null default 0` | `+1` on a permanent failure, `0` on success, unchanged on a transient one |

**Dead means two consecutive permanent failures**, `refresh_permanent_failures >= 2`. That is
cheap: the failed refresh already knows the row id, so the record is one `UPDATE ... SET
refresh_permanent_failures = refresh_permanent_failures + 1` with no read first, and the
successful refresh already writes the row, so the reset rides that write. A transient failure in
between leaves the count alone, so "consecutive" means consecutive permanent answers, not
consecutive attempts.

A second permanent failure follows soon after the first in practice: the access token is still
expired, so the next call for that account refreshes again.

A reconnect (`upsertServiceAccount`) resets all three, because new tokens are a new grant.

The columns hold reason codes only, never a token or a body. No query in this spec selects a
token column.

### 3. Return the reason to callers

`resolveServiceToken` gains one more result, beside the token and `AmbiguousAccount`:

```
type RefreshFailed = {
  refreshFailed: true;
  service: string;
  accountEmail: string | null;
  /** True when this failure made the connection dead (the count reached 2). */
  reconnectNeeded: boolean;
  token?: never; // fails closed for a caller that reads a token off it
};
```

**`mcp-server.ts` CallTool** words it truthfully. The service name and URL come from the same
place as today's sentences:

- reconnect needed: `Your <Service> account <email> needs reconnecting: <Service> no longer
  accepts the access it granted. Reconnect it at <url>.`
- otherwise: `<Service> did not respond to a token refresh just now. Try the call again in a
  moment.`

`connectionFailureService` learns the first sentence, so the scheduler pauses a schedule with
"reconnect needed" as it does for a disconnected service. It does NOT learn the second: a
transient failure is a failed run, retried on the next tick, never a pause.

`getServiceToken` keeps returning `null` for its one caller, the tool tester, which shows its own
error. `file-source.ts` maps `RefreshFailed` to the `null` it returns today, so a file reference's
source refusal is unchanged in this step; giving it the same two sentences is a small follow-up.

### 4. Emit an event

A server event per failed refresh (name: Decision 1), with `service`, `reason`, `kind`,
`consecutive_permanent` and `reconnect_needed`, plus the acting user's identity like every
server event. Never the account email, a token or the provider's response.

### 5. What reads the fact

- **`list_connected_accounts`** adds `needs_reconnect: true` to an account whose connection is
  dead, and its description says so. The model can then tell the user which account to reconnect
  instead of guessing from scopes.
- **`loadConnectionsView`** adds `refresh: { needsReconnect: boolean; lastError: string | null }`
  per row. The screen does not render it in this step.
- **Follow-up ticket, not built here:** the connections screen's "reconnect needed" state, a
  badge and a one-click reconnect on a dead connection, reading `refresh.needsReconnect`.

### 6. The shape alert (SCRUM-164)

The pattern that matters: a user who keeps opening sessions and makes no tool calls for N days,
which a broken connection and a bored user both produce.

**Where the data is today.** A session start is recorded only as the PostHog event
`mcp_session_initialized` (`mcp-analytics.ts`), per user, with the client name and the credential
kind. It is not in Postgres, and it is not tied to a connection. A tool call is in both places:
the PostHog `tool_call` event (with `connector_type` and `account_email`) and a `usage_events`
row. So the alert is a PostHog query, per user, joined to Postgres for the connection facts.

**The query** (HogQL, for the daily routine; `{N}` days, `{N}` of 3 suggested):

```sql
SELECT
  distinct_id AS user_id,
  uniqExactIf(toDate(timestamp), event = 'mcp_session_initialized') AS days_with_sessions,
  countIf(event = 'mcp_session_initialized') AS sessions,
  countIf(event = 'mcp_tools_listed') AS tools_listed,
  countIf(event = 'tool_call') AS tool_calls
FROM events
WHERE timestamp >= now() - INTERVAL {N} DAY
  AND event IN ('mcp_session_initialized', 'mcp_tools_listed', 'tool_call')
GROUP BY distinct_id
HAVING days_with_sessions >= greatest({N} - 1, 1) AND tool_calls = 0
```

`tools_listed` against `sessions` answers SCRUM-164's third question: a client opening sessions
without listing tools is a reconnect loop, which is a different fault from a dead grant. Internal
accounts are excluded the way the routine already excludes them.

**The Postgres half**, for each `user_id` the alert returns (selects no token column):

```sql
SELECT sc.user_id, sc.service, ca.account_email,
       sc.last_refresh_at, sc.last_refresh_error, sc.refresh_permanent_failures,
       sc.updated_at
FROM service_connections sc
JOIN connected_accounts ca ON ca.service_connection_id = sc.id
WHERE sc.user_id = ANY($1);
```

A user in the alert with `refresh_permanent_failures >= 2` is broken and an outreach trigger. One
with no refresh error is quiet, or stuck in the client (look at `tools_listed`).

**Fields this needs.** All exist today except the three new columns. Not available, and named
rather than invented: a session tied to a connection. A session is per user, so the alert cannot
say which of a user's connections the sessions were for. Decision 3 asks whether to add it.

`token_expires_at` is not a health signal and the alert does not use it: access tokens live about
an hour and refresh lazily, so nearly every connection reads as expired at any moment.

## Tests

- `classifyRefreshFailure`: every row of the table above, plus an `error_description` that is
  never returned.
- Each refresh (Google, Atlassian, Notion) on real Postgres:
  - a 400 `invalid_grant` records `last_refresh_error`, increments the count, and returns the
    failure;
  - a 429, a 500 and a thrown fetch record the reason and leave the count alone;
  - a success after failures resets all three;
  - missing client credentials records nothing.
- The count reaches dead only on the second consecutive permanent failure, and a transient
  failure between two permanent ones does not reset it.
- `upsertServiceAccount` clears the three on reconnect.
- `resolveServiceToken` returns `RefreshFailed` with `reconnectNeeded` false, then true.
- CallTool words each case; the transient sentence is not recognised by
  `connectionFailureService`, the reconnect sentence is (both directions in one test).
- `list_connected_accounts` shows `needs_reconnect` only on a dead connection.
- The event carries the reason and kind, and no email, token or body.

## Not done, on purpose

- The connections screen's "reconnect needed" state (follow-up ticket).
- Checking connections proactively. Refresh happens on use, which is the moment that matters, and
  adds no call to any provider.
- An outreach email on a dead connection. That is a separate process, run from the alert.
- Atlassian's missing refresh lock and revoke, which are SCRUM-444.

## Decisions to rule on

1. **The event.** `oauth_refresh_expired` already means our own MCP-client refresh token expired.
   This spec proposes a new event, `service_refresh_failed`, rather than overloading that one.
   Reusing it would mix two different grants in one series.
2. **The dead threshold.** Two consecutive permanent failures, as SCRUM-190 prefers. Google's
   `invalid_grant` is unambiguous, so one would also be safe for it and would tell the user one
   call sooner. Two costs one more failed call and protects against a provider's own mistake.
3. **Sessions per connection.** The shape alert is per user, because a session is not tied to a
   connection anywhere. Recording each session start in Postgres, with the account its first
   tool call resolved to, would make the alert per connection and answerable without PostHog. It
   costs one write per session.
