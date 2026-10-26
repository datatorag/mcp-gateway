# The connect callback: a Google account already connected elsewhere, and landing in the agent (SCRUM-363, SCRUM-96)

Status: spec, written from the code at `02e147d`. Nothing here is built. HQ reviews it with
Manuel before any of it is.

Two changes share one place, the end of a service-connect OAuth round trip:

- **SCRUM-363, option (a) only.** When the Google account being connected is already connected
  under another DataToRAG user, say so at connect time and offer to sign in as that user
  instead.
- **SCRUM-96.** A connect that did not start in a conversation ends in the agent with something
  already happening, instead of on the dashboard with a tick.

## What each limit keys on today

Read from the code, because the duplicate-account problem is a question of keys.

| What | Keyed on | Where |
|---|---|---|
| Plan | `users.plan` of the DataToRAG user making the call, written only by the Stripe webhook handlers | `billing/enforce.ts` `checkCallAllowance(db, userId)` reads `users.plan` by `users.id`; `billing/webhook-handlers.ts` writes it |
| The free-tier call cap | the same user's `current_period_calls`, against `planLimits(users.plan)` | `checkCallAllowance` → `callsRemaining(db, userId, …)` in `usage/period.ts` |
| Call counting | the same user: `countToolCall(db, userId)` bumps `users.current_period_calls`; each call also writes one `usage_events` row with that `user_id` | `usage/period.ts`, `usage/write.ts` |
| The agent-run allowance | the same user's `current_period_agent_runs`, against `planLimits(users.plan)` | `usage/period.ts` `agentRunCap`, `claimAgentRun` |
| Exemption from caps | the user's sign-in email or role (`capExempt`) | `usage/period.ts` |
| Which connected account a call runs as | the user's own `connected_accounts` rows, default or named | `service-token.ts` `resolveServiceToken` |

None of them consults the connected account. A connected Google account has no owner beyond the
DataToRAG user whose row holds it, and nothing stops two DataToRAG users from holding the same
one: `connected_accounts` is unique on (user, connector, email, external id), so the same
Google address under two users is two rows and both are valid. Each user then gets their own
plan, their own counters and their own allowance for calls against the same Google account.

That is why a person who signs in with a second email and connects the same work account ends
up on two plans at once, and why nothing in the product notices.

## Options for SCRUM-363

- **(a) Warn at connect time, offer to sign in as the other user. TAKEN.**
- (b) Resolve entitlement by connected-account ownership, so a connected account that belongs
  to a paid user carries the paid plan. **Not taken.** It makes the plan a function of which
  account a call runs as, which a call does not know before it resolves a token, and it turns
  a shared work account into a way to borrow someone else's plan.
- (c) Merge the two DataToRAG users. **Not taken.** A merge moves billing, threads, skills,
  schedules and connected accounts, and its shared-grant and disconnect questions are their own
  piece of work.

The remedy for users already split this way is HQ's, and is not in this spec.

## The callback, after this change

The three connect callbacks (`/auth/google/connect/callback`, `/auth/atlassian/connect/callback`,
`/auth/notion/connect/callback` in `auth.ts`) run in this order today: CSRF state, code exchange,
the zero-grant gate (Google only), the account's identity (userinfo, or the workspace for
Notion), `upsertServiceAccount`, `trackOAuthCompleted`, redirect through
`postConnectDestination`. Two branches are added.

```
code exchanged, identity known
  │
  ├─ held by ANOTHER DataToRAG user, and not yet by this one?      (new, SCRUM-363)
  │     yes → store nothing; render the duplicate page (below)
  │            ├─ "Sign in as that account"  → POST /auth/logout, then /auth/google
  │            └─ "Connect it here anyway"   → POST; sets a one-shot acknowledgement
  │                                            bound to a new connect's nonce, then
  │                                            restarts the connect (its callback
  │                                            skips this branch, once)
  │
  ├─ upsertServiceAccount, trackOAuthCompleted (unchanged)
  │
  └─ redirect
        ├─ a valid `next` was carried → that path, as today (the in-thread
        │  continuation from SCRUM-78 is unchanged)
        └─ no `next` → the agent's connect landing          (new, SCRUM-96)
              /dashboard/agent?connected=<service>&landing=connect
```

### The duplicate check

One helper in `connected-accounts.ts`, used by all three callbacks before the upsert:

`connectedElsewhere(db, userId, connectorType, accountEmail, externalAccountId): Promise<boolean>`

True when a `connected_accounts` row matches (connector, email, external id with `IS NOT
DISTINCT FROM`, the same match the unique key uses) under a different `user_id`, and no row
matches under this one. A reconnect of an account this user already holds is never a duplicate.
It answers a boolean: the other user's id and email never leave the function.

**Store nothing on this branch.** The tokens from this exchange are dropped. Holding them while
the user decides would mean parking a live grant somewhere; asking again costs one extra Google
round trip, and only on this rare branch. The zero-grant gate's pattern is the model: a refusal
writes neither table.

**"Connect it here anyway"** must stay possible, because two people sharing a work account is
legitimate, and the acknowledgement must not be something a link can carry. Today the connect
state is a bare random nonce checked against an httpOnly cookie, with no payload, and `proceed=1`
on the Google interstitial is a plain query parameter any link can set. Neither can bind this.
So:

1. The button is a form POST to a new route on the duplicate page. It answers by starting a new
   connect: a fresh nonce cookie, as every connect start sets, and beside it a one-shot httpOnly
   acknowledgement cookie holding that same nonce, with the nonce's TTL.
2. The callback honours the acknowledgement only when its value equals the nonce this callback
   just matched, and clears it in the same top-of-handler block that clears the nonce, so it is
   spent whether the rest succeeds or fails.
3. No query parameter on the start route or the callback skips the check. A `dup_ack` in either
   query string is ignored.
4. The POST route requires a valid `dtrmcp_session` and has the same cross-site protection as
   the logout POST, so another site cannot submit the form and arm the acknowledgement.

**"Sign in as that account"** signs this session out and starts a sign-in, so the user picks the
Google login of the other DataToRAG account in Google's chooser. We do not know which login that
is, and we do not say: see Decision 2.

### The duplicate page

A self-contained Express page in the shape of `connect-interstitial.ts`: light and dark, one
sentence of what happened, two buttons, and a Back link to the old destination with
`connect_error=connected_elsewhere`. Proposed copy, for HQ and Manuel:

> **This Google account is already connected to another DataToRAG account.**
> Usage and your plan follow the DataToRAG account you sign in with. If you meant to use that
> one, sign in with it instead.
> [Sign in with the other account] [Connect it here anyway]

The Atlassian and Notion pages say "Atlassian account" and "Notion workspace".

### The connect landing (SCRUM-96)

Today a connect with no valid `next` ends at `/dashboard?connected=<service>` (the old
connections index forwards there). After this change, `postConnectDestination`'s no-`next`
success fallback is `/dashboard/agent?connected=<service>&landing=connect`. Its error fallback
does not change, and every connect that carries a `next` (the agent's in-thread card, a skill's
deep link, the dashboard's reconnect controls) lands exactly where it does today.

On the agent page, `connected` with no `thread` and `landing=connect` opens a NEW thread, and
the empty state shows a connect-landing block: one line naming the service just connected, then
two concrete things it can do with that account, from the suggestion generator specified in
`2026-10-26-scrum-110-321-suggestions-design.md` with `context: "post_connect"`. Not a checklist, not a
wizard, not a modal: it is the normal empty state, led by what just became possible. What
happens on landing is Decision 3.

The once-only guard that SCRUM-78's continuation uses (a one-shot ref, and
`history.replaceState` dropping the params after the first render) applies here too, so a
reload does not repeat the landing.

## Events

Kept separable so the connected-to-ran-agent rate can be read for each half:

| Event | When | Properties |
|---|---|---|
| `account_connected` (existing) | after the upsert | adds `entry`: `"agent"` when the connect carried a `next` into the agent (SCRUM-78's half), `"connect"` otherwise (SCRUM-96's half) |
| `connect_landing_shown` (new, client) | the connect landing renders | `service` |
| `agent_run` (existing) | a run starts | adds `after_connect_landing: true` on the first run of a thread opened by the landing |
| `account_connect_duplicate` (new, server) | the duplicate branch is taken | `service`, `resolution`: `"shown"`; then `"signed_in_other"` or `"connected_anyway"` from the button's leg |

None carries the other user's identity, an email, or content.

## Tests

- `connectedElsewhere`: true for a row under another user; false for this user's own reconnect;
  false when both users hold it; Notion matches on the workspace id, Google and Atlassian on the
  email with a null external id. Real Postgres, because the match is the unique key's.
- Each callback: on a duplicate, writes neither table, renders the page, and fires the event.
  With an acknowledgement cookie whose value equals the matched nonce, it takes the normal path
  once and clears the cookie. With `dup_ack=1` in the start or callback query string and no bound
  acknowledgement, or with an acknowledgement for a different nonce, it still renders the
  duplicate page. The page names no other user.
- `auth-callback-ordering.test.ts` covers the acknowledgement cookie, so clearing it first in
  the callback is enforced like the nonce.
- The "Connect it here anyway" route refuses a request with no session or a cross-site origin.
- The page's "Sign in with the other account" is a POST to `/auth/logout` with the existing
  protections, and its Back link is only ever the output of `postConnectDestination`, never a
  raw `next`.
- `postConnectDestination`: the no-`next` success fallback is the connect landing; the error
  fallback and every `next` case are unchanged (the existing table tests, extended).
- The agent page: `connected` plus `landing=connect` and no thread opens a new thread with the
  landing block once; a reload does not repeat it; `connected` with a thread is the SCRUM-78
  continuation, unchanged.

## Two questions asked alongside SCRUM-363

**Is `usage_events.client` null by design?** It is null by construction: the column has existed
since the table was created, and no write path sets it, in `usage/write.ts` or anywhere else in
the current code. A call's provenance is recorded elsewhere, as `client_id` and `client_name` on
the PostHog `tool_call` event (SCRUM-189). So it is not a defect that started recently; it is a
column nothing writes. Recommendation: either write `client_name` into it from the same place
the PostHog event gets it, or drop the column. Leaving it suggests a fact the table does not
hold.

**Is `users.updated_at` meant to be maintained by metering writes?** No write in the metering
path touches it: `rollAndBump` in `usage/period.ts` updates the period counters and nothing
else. It is set by the Stripe webhook handlers when the plan or the customer id changes. Read
as "the last time the account's settings or billing changed", that is consistent.
Recommendation: keep it that way and say so on the column, rather than bump it on every tool
call, which would make it a second last-activity timestamp and useless for its own question.

## Not done, on purpose

- Options (b) and (c), and any remedy for users already split.
- Blocking a second DataToRAG user from connecting an account: sharing is legitimate.
- Naming the other DataToRAG user anywhere on the page.
- A checklist, wizard or modal after connecting.
- Any change to what a connect carrying a `next` does.

## Decisions to rule on

1. **Hold or store on the duplicate branch.** This spec stores nothing and asks again on
   "Connect it here anyway" (one extra Google round trip, no parked tokens). The alternative
   stores the connection and shows the warning afterwards, which keeps the extra round trip
   off the table but lets the split happen before the user has read the warning.
2. **What the page says about the other account.** This spec names nothing. Showing the other
   DataToRAG user's sign-in email, even masked, tells whoever controls a shared work account
   which personal login a colleague uses. The cost of naming nothing is that the user has to
   remember which login they used.
3. **What happens on the connect landing.** This spec shows two concrete suggestions and runs
   nothing until the user picks one. The strong version in SCRUM-96 runs a small read
   immediately and shows the result; it is more convincing and it spends an agent run from
   the user's allowance without being asked.
