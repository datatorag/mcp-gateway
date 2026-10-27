# Provider refresh failures become a recorded fact (SCRUM-190, SCRUM-164)

Status: spec, written from the code at `2c5be1b`, with its three decisions ruled on 2026-10-26
(the last section). Nothing here is built until a go. Not user-visible in this step; no changelog
entry.

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
the gateway's own endpoint. So provider refresh failures get their own event,
`service_refresh_failed` (section 4).

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

One migration adds three columns to `service_connections` (and the `mcp_session_starts` table of
section 6):

| Column | Type | Written |
|---|---|---|
| `last_refresh_at` | `timestamptz` | on every refresh attempt, success or failure |
| `last_refresh_error` | `text` | the reason code on failure, `NULL` on success |
| `refresh_permanent_failures` | `integer not null default 0` | `+1` on a permanent failure, `0` on success, unchanged on a transient one |

**Dead means one Google `invalid_grant`, or two consecutive permanent failures.** One function
decides it, `connectionDead(service, row)`:

- a Google Workspace row whose `last_refresh_error` is `invalid_grant` (and whose count is
  therefore at least 1) is dead at once: Google sends that answer only when the grant is revoked
  or expired, so a second call would only fail the same way;
- any row with `refresh_permanent_failures >= 2` is dead, which covers Atlassian, Notion, and
  Google's other permanent answers.

Keeping the count is cheap: the failed refresh already knows the row id, so the record is one `UPDATE ... SET
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
  /** True when `connectionDead` holds after this failure. */
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

A server event per failed refresh, `service_refresh_failed` (added to `lib/analytics.ts` in the
doc-comment style there), with `service`, `reason`, `kind`,
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
kind. It is not in Postgres and not tied to a connection. A tool call is in both places: the
PostHog `tool_call` event and a `usage_events` row, which carries `connector` and
`account_email`.

**Session starts in Postgres, per resolved account.** A new table, `mcp_session_starts`:

| Column | Type |
|---|---|
| `id` | `uuid` primary key |
| `user_id` | `uuid`, references `users`, cascade |
| `connected_account_id` | `uuid`, references `connected_accounts`, cascade |
| `client_name` | `text`, cleaned and capped like any client-chosen name |
| `started_at` | `timestamptz not null default now()` |

Indexed on `(connected_account_id, started_at)`. At `initialize`, beside the existing
`trackMcpSessionInitialized`, the gateway runs ONE statement:

```sql
INSERT INTO mcp_session_starts (user_id, connected_account_id, client_name)
SELECT user_id, id, $2 FROM connected_accounts
WHERE user_id = $1 AND is_default;
```

That is one write per session: one row for each service's default account, which is the
account every call without an `account` argument resolves to. A user with no connection gets no
row. Fire-and-forget like the PostHog capture, so a failed insert never delays or fails the
initialize. The nightly rollup prunes it at 90 days, the same window as `usage_events`.

A call that names a non-default `account` is not tied back to the session. The alert below asks
about the account a session would have used, which is the one a broken grant hurts.

**The query**, Postgres only, per connection (`$1` is N days, 3 suggested; selects no token
column):

```sql
WITH starts AS (
  SELECT connected_account_id,
         count(DISTINCT started_at::date) AS days_with_sessions,
         count(*) AS sessions
  FROM mcp_session_starts
  WHERE started_at >= now() - make_interval(days => $1)
  GROUP BY connected_account_id
)
SELECT ca.user_id, ca.connector_type, ca.account_email, s.days_with_sessions, s.sessions,
       sc.last_refresh_at, sc.last_refresh_error, sc.refresh_permanent_failures
FROM starts s
JOIN connected_accounts ca ON ca.id = s.connected_account_id
JOIN service_connections sc ON sc.id = ca.service_connection_id
WHERE s.days_with_sessions >= greatest($1 - 1, 1)
  AND NOT EXISTS (
    SELECT 1 FROM usage_events ue
    WHERE ue.user_id = ca.user_id
      AND ue.connector = ca.connector_type
      AND ue.account_email = ca.account_email
      AND ue.created_at >= now() - make_interval(days => $1)
  );
```

A row whose connection is dead (`connectionDead`) is broken and an outreach trigger. One with no
refresh error is quiet, or stuck in the client. Internal accounts are excluded the way the
routine already excludes them.

**Still a PostHog read:** SCRUM-164's third question, a client opening sessions without listing
tools (a reconnect loop, a different fault from a dead grant), because `mcp_tools_listed` is a
PostHog event only. The routine compares `mcp_session_initialized` with `mcp_tools_listed` per
user there.

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
- `connectionDead`: a Google `invalid_grant` is dead on the first failure; an Atlassian or Notion
  `invalid_grant`, and Google's `invalid_client`, are dead only on the second consecutive
  permanent failure; a transient failure between two permanent ones does not reset the count.
- Session starts: an `initialize` writes one statement and one row per default account; a user
  with no connection writes none; a failed insert does not fail the initialize; the rollup prunes
  rows older than 90 days.
- The alert query, on real Postgres: a default account with sessions on enough days and no
  `usage_events` row is returned; one with a tool call is not; a non-default account is never
  counted.
- `upsertServiceAccount` clears the three on reconnect.
- `resolveServiceToken` returns `RefreshFailed` with `reconnectNeeded` false, then true (and true
  at once for a Google `invalid_grant`).
- CallTool words each case; the transient sentence is not recognised by
  `connectionFailureService`, the reconnect sentence is (both directions in one test).
- `list_connected_accounts` shows `needs_reconnect` only on a dead connection.
- `service_refresh_failed` carries the reason and kind, and no email, token or body.

## Not done, on purpose

- The connections screen's "reconnect needed" state (follow-up ticket).
- Checking connections proactively. Refresh happens on use, which is the moment that matters, and
  adds no call to any provider.
- An outreach email on a dead connection. That is a separate process, run from the alert.
- Atlassian's missing refresh lock and revoke, which are SCRUM-444.

## Decisions (ruled 2026-10-26)

1. **The event.** A new event, `service_refresh_failed`. `oauth_refresh_expired` keeps its one
   meaning, our own MCP-client refresh token.
2. **The dead threshold.** Dead after one Google `invalid_grant`, or after two consecutive
   permanent failures for anything else.
3. **Sessions per connection.** Session starts are recorded in Postgres per resolved account, one
   write per session, and the shape alert is per connection.
