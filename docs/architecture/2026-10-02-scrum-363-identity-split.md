# One person, two users: a paid plan the calls never reach (SCRUM-363)

Date: 2026-10-02. Status: spec only. Nothing here is built, and nothing here
has been run against production.

## Problem

A paying customer signed in a second time with a different Google login and
connected the same work accounts there. Their MCP client is authorised as the
second user, which is on the free plan. Every call is counted against the
free allowance and stops at the free cap, while the paid user sits unused.

Each user row is correct on its own. The product has no place where it
compares two users, so it cannot see the split.

## 1. What each decision keys on

Everything below keys on `users.id`, and a user is created per login email.
Nothing keys on the connected account.

| Decision | Keyed on | Where |
|---|---|---|
| Which user a login is | `users.email` = the Google login's email; no row means a new user | `apps/gateway/src/gateway/auth.ts` (dashboard login, the lookup before `insert(users)`); `apps/gateway/src/gateway/oauth/authorize.ts` (the MCP client's OAuth callback, same lookup and insert) |
| Which user an MCP request is | the bearer's `oauth_access_tokens.user_id`, or `api_keys.user_id` | `apps/gateway/src/gateway/bearer-auth.ts`, `resolveBearer` |
| Plan | `users.plan` of that user | `apps/gateway/src/gateway/billing/enforce.ts`, `checkCallAllowance`, called before dispatch in `apps/gateway/src/gateway/mcp-server.ts` |
| Who the plan is written for | `users.stripe_customer_id`, else the subscription's `user_id` metadata, else the checkout's `client_reference_id` | `apps/gateway/src/gateway/billing/webhook-handlers.ts`, `resolveUserId` and the checkout handler |
| Call metering | `users.current_period_calls` and one `usage_events` row, both for that user | `apps/gateway/src/gateway/track.ts` (`trackToolCall`), `apps/gateway/src/gateway/usage/period.ts` (`countToolCall`), `apps/gateway/src/gateway/usage/write.ts` |
| Agent-run allowance | `users.plan` and `users.current_period_agent_runs` of the session user | `apps/gateway/src/gateway/usage/period.ts` (`agentRunCap`, `claimAgentRun`), claimed in `apps/gateway/src/app/api/playground/chat/route.ts` |
| Cap exemption | the user's own email, by domain | `apps/gateway/src/gateway/usage/period.ts`, `capExempt` |
| Which Google or Atlassian account a call runs as | `connected_accounts` rows of that user | `apps/gateway/src/gateway/service-token.ts`, `resolveServiceToken` |

Two facts make the split possible and invisible:

- `connected_accounts` is unique on `(user_id, connector_type, account_email)`.
  The same outside account can be connected under any number of users, and
  `upsertServiceAccount` (`apps/gateway/src/gateway/connected-accounts.ts`)
  looks only inside the connecting user.
- The MCP client's OAuth flow and the dashboard login both create a user for
  an email they have not seen. A person who picks a different Google login in
  either place gets a new free user with no warning.

## 2. Three remedies

### (a) Say so at connect time. Recommended.

When a connect finishes, look for the connected account under another user.
Two cases, told apart on purpose:

- **The connected account is itself a login.** `account_email` equals another
  user's `users.email`. The person has just proved control of that account, so
  naming it tells them nothing they do not hold. Say: this account is already
  a DataToRAG login, with its plan, and offer to sign in with it instead. If
  that user is on a paid plan and this one is free, say that too. This is the
  case that happened.
- **The account is connected under another user, and is not that user's
  login.** A shared mailbox connected by several colleagues looks like this.
  Say only that the account is also connected under another DataToRAG login.
  Do not name the other login: the person proved control of the shared
  account, not of a colleague's identity.

The connect is stored either way. This is a notice, not a gate: connecting
one outside account under two users is allowed today and some teams rely on
it.

The same check belongs in one more place. The split costs the customer
something only when a free user is refused at the cap, so the free-cap
refusal in `checkCallAllowance` should add one sentence when the first case
holds for the refused user: a paid plan exists under the other login. That
reaches a person who never opens the dashboard.

Cost: small. One query on `connected_accounts` joined to `users` in the two
connect callbacks, one notice on the two landing surfaces that already show
connect outcomes, one sentence on the refusal. No schema change. An index on
`connected_accounts (connector_type, account_email)` keeps the lookup off a
scan.

What it does not do: it does not move the calls. The person still has to
re-authorise their MCP client with the other login.

### (b) Entitlement by connected-account ownership. Not recommended.

Resolve plan as the best plan among every user holding the same connected
account. The calls would get the paid allowance with no action from anyone.

Costs and hazards:

- It turns a shared account into a shared plan. Five colleagues who each
  connect one team mailbox under five free users would all read as paid from
  one subscription. The plan sells call volume and nothing else, so this is
  the one thing it must not give away.
- Plan is read on every call before dispatch. Today that is one row by
  primary key; this makes it a join across users on every call.
- The counters stay per user, so "the paid allowance" would be one allowance
  per user, each uncapped on Pro. Usage, the Billing page and the agent-run
  meter would all describe a user that is not the one paying.
- Downgrade and cancellation would have to reach users the webhook has never
  heard of.

### (c) Account merge. Right eventually, large now.

Fold one user into another. Honest cost:

- Eighteen tables reference `users.id` (counted from the schema directory,
  every `references(() => users.id`). Most rows can be re-pointed.
  Three cannot be re-pointed blindly: `connected_accounts` collides on its
  unique key when both users hold the same account, user-owned skills
  collide per owner and slug, and `subscriptions` must stay with the Stripe customer.
- The counters have to be added, not copied, and both share one period start.
- A merge that deletes the losing user is undone by the next login with that
  email, which creates the user again. A merge therefore needs a new thing:
  more than one login email per user, checked in both places a login becomes
  a user. That is a schema change and a change to both auth callbacks.
- Analytics identify people by user id, so history splits at the merge unless
  the two ids are aliased there as well.

Worth doing when a second or third case shows the notice is not enough, and
as its own ticket.

### Shared grants and disconnect

This interacts with all three remedies and with (a) most.

Google issues one grant per outside account per OAuth client. Two users who
connect the same Google account each store their own refresh token, and both
tokens belong to that one grant. `disconnectAccount` and `disconnectService`
(`apps/gateway/src/gateway/connected-accounts.ts`) call `revokeUpstream`
unconditionally, and revoking either refresh token ends the grant for both.
So a person told by the notice in (a) to tidy up, who disconnects the account
under the user they are leaving, silently breaks it under the user they are
keeping. The next call there fails with a reconnect message.

Any build of (a) therefore carries one rule: when another user holds the same
`(connector_type, account_email)`, a disconnect deletes the local rows and
does not revoke upstream. The grant is still wanted. The notice should also
say that disconnecting is not needed. A merge has the mirror problem: it must
keep one of the two `service_connections` rows and drop the other without
revoking. Atlassian has no upstream revocation today, so only Google is
affected.

### Recommendation

Build (a), with the disconnect rule, and the sentence on the free-cap
refusal. Leave (c) as a ticket. Do not build (b).

## 3. A one-off remedy for an existing pair

A proposal. Nothing below has been run. Each step names the user ids as
parameters; the real ids stay out of this repository. A human confirms the
target before anything touches production.

Call the paying user `:paid` and the second, free user `:free`.

**Step 0, no data change, preferred.** Ask the customer which login they want
to keep. If it is the paid one, they remove the connector in their MCP client
and add it again, choosing the paid login at Google's account chooser. From
that moment calls land on `:paid`. Nothing else is needed, and it is the only
option that also fixes what they see in the dashboard.

**Step 1, read first, whichever option follows.** One query, read only:

```sql
SELECT u.id, u.plan, u.stripe_customer_id IS NOT NULL AS has_customer,
       u.current_period_calls, u.current_period_start,
       (SELECT count(*) FROM oauth_access_tokens t
         WHERE t.user_id = u.id AND t.client_id <> 'web'
           AND t.revoked_at IS NULL AND t.expires_at > now()) AS live_client_tokens,
       (SELECT count(*) FROM api_keys k
         WHERE k.user_id = u.id AND k.revoked_at IS NULL) AS live_keys,
       (SELECT json_agg(json_build_object('connector', c.connector_type,
                'account', c.account_email, 'default', c.is_default)
                ORDER BY c.connector_type, c.account_email)
          FROM connected_accounts c WHERE c.user_id = u.id) AS accounts
FROM users u
WHERE u.id IN (:paid, :free);
```

It must return exactly two rows, `:paid` on a paid plan with a Stripe
customer, `:free` on free. Stop if it does not.

**Option A, if the customer cannot or will not re-authorise: move the client's
tokens to the paid user.** The client keeps working and its next call lands
on `:paid`.

Precondition, from step 1: every account `:free` holds is also held by
`:paid`, with the same default per connector. A call that names no account
runs as the default, so a different default would send a write from an
account the person did not pick. If the sets or the defaults differ, do not
run this; use step 0.

```sql
BEGIN;
UPDATE oauth_access_tokens SET user_id = :paid
 WHERE user_id = :free AND client_id <> 'web' AND revoked_at IS NULL
RETURNING id;
UPDATE oauth_refresh_tokens SET user_id = :paid
 WHERE user_id = :free AND client_id <> 'web' AND revoked_at IS NULL
RETURNING id;
-- compare both counts with step 1 before committing
COMMIT;
```

Rollback is the same two statements with the ids swapped, limited to the row
ids the first run returned. Live MCP sessions are held in memory by user, so
the change takes effect on the client's next initialise, which a gateway
restart forces. Dashboard sessions (`client_id = 'web'`) are left alone.
API keys are not moved: step 1 reports them, and a live key under `:free`
needs the customer to mint a new one under `:paid`.

**Option B, a courtesy while they decide: put the free user on the paid plan
by hand.**

```sql
UPDATE users SET plan = 'pro', updated_at = now()
 WHERE id = :free AND plan = 'free'
RETURNING id, plan, updated_at;
```

This lifts the cap at once and changes nothing else. It also makes the split
permanent and silent: no Stripe event will ever downgrade that row, and its
Billing page will say the plan is not billed through Stripe. It is a stopgap
with an owner and an end date, not a fix. Undo with the same statement and
the two plan values swapped.

Neither option moves usage history, and neither should. The rows under
`:free` record calls that user made.

Recommended order: step 0. If the customer is blocked at the free cap before
they act, option B for a named number of days, then step 0. Option A only
when the precondition holds and the customer has asked not to re-authorise.

## 4. Two side observations

**`usage_events.client` is null on every row. Confirmed, and wider than
reported.** The column has been in the schema since the table was added, and
the only writer, `writeUsageEvent` in
`apps/gateway/src/gateway/usage/write.ts`, has never set it; the history of
that file contains no write to it. It is null for every row ever written, not
only recent ones. The client's registration id and self-reported name do
exist per call: `trackToolCall` sends them to analytics as `client_id` and
`client_name` and stops there. The same is true of `idempotency_key`,
`cost_units` and `arguments_size_bytes`: declared, never written. Either
write `client` from the value `trackToolCall` already holds, or drop the
four columns; today they read as data that was not collected by accident.

**`users.updated_at` is not maintained by the metering writes. Confirmed.**
It is set only by billing code: the checkout route when it stores a Stripe
customer, and the webhook handlers when they set the plan or the customer. The writes that do not touch it: both counter statements in
`usage/period.ts` (raw `UPDATE users`), the first-tool-call and
first-agent-run claims in `track.ts`, the attribution snapshot, and the
lifecycle email claim. There is no trigger. So `updated_at` means "billing
last changed this row", not "last activity", and it must not be read as
recency. The honest signals for activity are `current_period_start` with the
counters, and the newest `usage_events.created_at`. Leaving the column alone
is defensible, since bumping it on every call would add a write to the hot
path for no reader; what needs fixing is any report that reads it as last
seen.

## What this spec did not do

- No query was run against production. Section 1 and section 4 are read from
  the code and its history; whether a given pair matches the precondition in
  option A is unknown until step 1 is run.
- The number of other split pairs is not measured. The check in (a), run once
  as a read, would count them: accounts whose `account_email` is another
  user's `users.email`.
- Google's one-grant-per-account behaviour in the disconnect section is
  Google's documented revocation rule applied to this code. It was not
  reproduced here against a live pair.
