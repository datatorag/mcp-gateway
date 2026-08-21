---
name: services-integrations
description: Use when touching datatorag-mcp's third-party integrations — Brevo email lifecycle, Slack (Dara bot), Stripe, PostHog analytics, or the track/digest event pipeline. Patterns, event flows, and masking rules per service.
---

# Services & Integrations

Third-party service clients for the gateway app. See `codebase-map` for how these fit into the overall gateway request flow — this skill is the per-service detail.

**The shared shape, once, so each service section below can just say "follows the pattern":** every side-channel client (Brevo, Slack) is a never-throw HTTP wrapper —

```ts
async function callThing(...): Promise<boolean> {
  const key = getEnv().THING_API_KEY;
  if (!key) { console.warn("[thing] THING_API_KEY not set — skipping"); return false; }
  try {
    const res = await fetch(url, { ... , signal: AbortSignal.timeout(N) });
    if (!res.ok) { console.warn(`[thing] failed: ${res.status} ${(await res.text()).slice(0, 300)}`); return false; }
    return true;
  } catch (err) { console.warn("[thing] error", err); return false; }
}
```

No env var/token → warned no-op, not a throw. Non-2xx or a network error → warned `false`, not a throw. Error bodies are truncated to 300 chars in the warn log — don't expect full payloads there. New integrations should copy this shape rather than inventing a new failure contract.

## Per-service patterns

### Brevo (transactional email)

Entry file: `apps/gateway/src/lib/brevo.ts`. Single internal `brevoPost()` helper (follows the shape above) wraps all HTTP calls; two public functions call it: `upsertBrevoContact()` (`POST /contacts`) and `sendBrevoTemplate()` (`POST /smtp/email`).

- List/template IDs (`BREVO_LIST_PRODUCT_USERS`, `BREVO_TEMPLATE_WELCOME`, `BREVO_TEMPLATE_NO_ACTIVATION`) are hardcoded constants, not env vars — they're managed in the Brevo console.
- `isInternalEmail()` checks the comma-separated `INTERNAL_EXCLUDE_EMAILS` env var (same env-side list the digest exclusion reads; values live in SSM/prod `.env`, never in source — this repo is public) plus the `@datatorag.com` domain, which is matched unconditionally in code; lifecycle emails must skip these.
- `hasBrevoKey()` lets callers check availability before doing other work (see Lifecycle below, which checks this *before* claiming a DB row).
- Env var: `BREVO_API_KEY`.

### Slack (Dara bot)

Entry file: `apps/gateway/src/lib/slack.ts`. `sendSlack(channel, message)` (follows the shape above, plus one extra check — see below) posts to `https://slack.com/api/chat.postMessage` with `Authorization: Bearer <SLACK_BOT_TOKEN>`.

- `channel` is a logical name (`"leads" | "digest" | "alerts" | "feedback"`) resolved through the `CHANNEL_ENV` lookup table to one of `SLACK_CHANNEL_LEADS`, `SLACK_CHANNEL_DIGEST`, `SLACK_CHANNEL_ALERTS`, `SLACK_CHANNEL_FEEDBACK`. To add a new logical channel: extend the `SlackChannel` union, add a row to `CHANNEL_ENV`, add the var to `.env.example` (+ `docker/docker-compose.prod.yml` env forwarding) — don't hardcode a channel ID at the call site. `"feedback"` receives playground thumbs up/down (see the Playground section below).
- Slack's Web API returns HTTP 200 even for API-level errors, so `sendSlack` checks both `res.ok` and the parsed body's `data?.ok` before treating a send as successful — this is the one place the shared wrapper shape isn't enough on its own.
- This replaced a webhook-based implementation (commit `a426a0a`, preceded by `8dad409`) so the existing "Dara" Slack app's bot token could be reused instead of provisioning three separate webhook URLs.
- Call sites use `void sendSlack(...)` (fire-and-forget) so a Slack outage never blocks the request path — see `track.ts`, `route.ts`, `lifecycle.ts`, `digest.ts`, `signup-alert.ts`.
- Env var: `SLACK_BOT_TOKEN` (plus the four channel vars above).

### Stripe

Entry file: `apps/gateway/src/lib/stripe.ts`. `getStripe()` is a lazy singleton that **throws** if `STRIPE_API_KEY` is unset — unlike Brevo/Slack, Stripe is load-bearing wherever it's called, not a best-effort side channel; there's no warned-no-op path to copy here. `ensureStripeCustomer()` lazily creates a Stripe Customer only when `existingId` is absent, tagging it with `metadata: { user_id }`. Env vars: `STRIPE_API_KEY`, `STRIPE_WEBHOOK_SECRET`.

### PostHog (server / Node)

Entry file: `apps/gateway/src/lib/posthog-server.ts`. `getPosthog()` is a lazy singleton that returns `null` (not throw, not warn) when `POSTHOG_API_KEY` is unset — every caller must null-check (`const c = getPosthog(); if (!c) return;`) rather than relying on a warn log. `flushAt: 20`, `flushInterval: 10_000`. Host is hardcoded (`https://us.i.posthog.com`), not env-driven. `shutdownPosthog()` resets the client for clean process exit — call it on graceful shutdown so buffered events flush. Env var: `POSTHOG_API_KEY`.

### PostHog (client / browser)

Entry file: `apps/gateway/src/components/posthog-provider.tsx`. Module-scope `posthog.init()` gated on `NEXT_PUBLIC_POSTHOG_KEY`, with `capture_pageview: false` plus a manual `PageviewTracker` that fires `$pageview` on route change, and an `IdentifyUser` component that calls `posthog.identify()` off the current user. `capture_pageleave` and `capture_performance.web_vitals` are on. Env var: `NEXT_PUBLIC_POSTHOG_KEY`.

Note: `digest.ts`'s `collectPosthog()` uses a *different* credential pair — `POSTHOG_PERSONAL_API_KEY` + `POSTHOG_PROJECT_ID` (personal API key against PostHog's own HogQL query endpoint) — from the ingestion client above (`POSTHOG_API_KEY`, project API key). These are not interchangeable; don't reuse one for the other.

## Event pipeline

`apps/gateway/src/gateway/track.ts` fires PostHog events and gates the activation milestone:

- `trackToolCall()` — fires PostHog `tool_call` on every classified call, then (only when `status === "success"`, `props.outcome.source === "mcp"`, and the user isn't already activated) claims the `first_tool_call` milestone via `trackFirstToolCall()`, then writes a metering usage row via `writeUsageEvent`.
- `trackFirstToolCall()` uses an atomic `UPDATE users SET first_tool_call_at = ... WHERE first_tool_call_at IS NULL RETURNING id` — checking `.length === 0` to detect a lost race — rather than SELECT-then-UPDATE. This is the pattern for any other exactly-once side effect.
- `trackSignup()` is PostHog-only (`identify` + `user_signed_up` capture). The #leads Slack post for signups lives in `apps/gateway/src/gateway/signup-alert.ts` `notifySignup(db, user)` (SCRUM-26, enriched in SCRUM-85), called from the same `isNewUser` branch in `auth.ts`: it skips internal accounts via `isInternalEmail` (the SCRUM-6 lesson — `trackSignup`'s old inline Slack line didn't). Provenance comes from the `acquisition_*` columns on the users row (read back AFTER `persistAcquisition`, so the alert reports what was actually stored): a `Source:` line (channel + utm detail or referring domain + a gclid-presence flag — never the raw gclid) and a `Landed:` line (entry PATH only, query string stripped). An absent snapshot prints `Source: unknown (no acquisition data captured)` — deliberately explicit, it's the in-channel signal that attribution capture broke. The newest `leads` row by email still feeds a secondary `Lead match:` line (`none` vs `✓ converted` + the lead's own UTM set). Never-throw, `void`-called.
- `trackOAuthCompleted()` fires `account_connected`, carrying `grant_complete` + `missing_scopes` (SCRUM-136): the consent screen lets a user untick scopes, and the event still fires on a partial grant — the property carries the split, so the funnel count keeps its meaning. `connect_card_shown`'s `outcome` gained `reconsent_shown` the same way (a card placed for a connected-but-short grant).

**Connection-path events** (`apps/gateway/src/gateway/mcp-analytics.ts`) close the copy_mcp_config → tool_call blind spot — before these, a client could connect, list tools, or fail auth with no trace:

- `mcp_request_received` (every request at `/mcp`, with the `classifyMcpRequest` action + client name/version off initialize bodies), `mcp_session_initialized` (completed handshake), `mcp_auth_failed` (reason class: `missing_credential`/`invalid`/`expired`/`revoked` — expired/revoked attribute to the token's owner), `mcp_tools_listed` (tool count only). Wired in `server.ts`'s `/mcp` handler + `mcp-server.ts`'s ListTools.
- Same `distinctId` (gateway user id) and `identityProps()` as every other server event, so the activation funnel joins; unauthenticated traffic lands under the stable `mcp_anonymous` person instead of being dropped.
- **Never capture request bodies, tool arguments, or tool names in these events** — counts, outcomes, and client name/version only.
- `validateBearer` in `server.ts` fetches the token row without liveness conditions to classify rejects; acceptance is `isTokenLive()` (`src/lib/token-liveness.ts`), the row-level mirror of `liveTokenConditions()` — the two live in one file and must not drift.

**Playground (LLM loop):** the dashboard playground (`apps/gateway/src/gateway/playground/`, streamed by `POST /api/playground/chat`) has its own analytics track, deliberately separate from `trackToolCall`:

- New server-side events in `track.ts` (names in `src/lib/analytics.ts` `EVENTS`): `playground_message_sent`, `agent_run`, `playground_cap_hit`, `playground_confirm`, `playground_feedback`, plus `tool_call` (shared with the gateway surface, carrying `surface` and `run_id`) — all never-throw, all spread `identityProps()`. Client-side (posthog-js, dashboard components): `playground_prompt_run` (a "What can I do?" card's Run button), `wizard_client_selected`, `wizard_step_completed` (setup wizard).
- **Both surfaces meter; activation is still gated (CRITICAL invariant):** agent tool calls DO write `usage_events` now — this reversed on the `agent-metering` branch. There is one `tool_call` event for both surfaces, distinguished by a `surface` property (`"mcp" | "agent"`, `usage/classify.ts`), not by a second event name; `trackPlaygroundToolCall` is gone. What did NOT change is activation: `first_tool_call_at` is still set only for `surface: "mcp"`, because the no-activation follow-up email and the digest both key off it and it must keep meaning "a real MCP client called through the gateway". If you add a surface, meter it and leave activation alone.
- **Cap claim/refund:** `usage/period.ts` holds the per-period allowance. `claimAgentRun` is a guarded single-statement `UPDATE ... WHERE used < cap RETURNING` (claim = row came back), `refundAgentRun` the compensating guarded decrement for a turn that consumed nothing, so a provider outage never burns an allowance. Both go through `rollAndBump()`, which lazily rolls the period and writes *both* counters on every path — that is what keeps agent runs and tool calls describing the same window. It is a COUNTER, NOT A LEDGER; read the file header before reusing it for anything billing-shaped. Copy this claim/refund pair for any future "capped best-effort" feature. (The older lifetime-cap pair in `playground/cap.ts` was deleted; that file now holds only `capToolOutput`.)
- **Prompt caching is required, not optional:** `playground/engine.ts` sets `cache_control: { type: "ephemeral" }` on the system block and the *last* tool block. The tool schemas (~15k tokens for a GWS user) repeat on every loop iteration and every message — without caching each turn re-pays full input price. Preserve this when touching the engine's `messages.create` call.
- **Feedback:** `trackPlaygroundFeedback` (from `POST /api/playground/feedback`) does a PostHog capture plus `void sendSlack("feedback", ...)` showing the **full** user email (same deliberate no-masking policy as leads/signup notifications).
- Model factory: `apps/gateway/src/lib/llm.ts` — `getPlaygroundModel()` returns an AI SDK `LanguageModel` from `@ai-sdk/anthropic`, or `null` when the playground is disabled. Env vars: `ANTHROPIC_API_KEY` (empty = playground disabled), `PLAYGROUND_MODEL` (default `claude-sonnet-5`), `SLACK_CHANNEL_FEEDBACK`. **`PLAYGROUND_MESSAGE_CAP` and `users.playground_messages_used` are orphaned** — they backed the old lifetime cap and no production code reads either since the per-period allowance replaced it. Retire the env var, the config key and the column together in one change with a migration; don't half-remove them.

`apps/gateway/src/gateway/digest.ts` runs the daily Slack digest: `runDailyDigest()` runs three collectors in parallel via `Promise.all` — `collectNeon` (DB queries for leads/signups/tool-calls/connections), `collectStripe` (Stripe Events API), `collectPosthog` (HogQL query over PostHog's own query API). Each is wrapped by `runSource()`, which catches a collector failure, alerts `#alerts` via Slack, and returns `null` so the digest still renders that section as unavailable rather than failing outright. The final message posts via `sendSlack("digest", ...)`. `MAX_LEAD_LINES = 10` caps the lead list (Slack caps messages at 50 blocks).

**Internal-traffic exclusion (digest + any future raw analytics query):** raw HogQL/API queries do NOT inherit PostHog's insight-level "filter test accounts" setting, and DB counts see every row — so digest queries exclude internal traffic explicitly. `digest.ts` exports `internalExclusion()` (parses comma-separated `INTERNAL_EXCLUDE_EMAILS` / `INTERNAL_EXCLUDE_IDS` env vars) and `posthogInternalFilterSql()` (a leading-`AND` HogQL fragment). The `@datatorag.com` domain is excluded unconditionally in code; personal/test emails and legacy distinct_ids live only in env (SSM/prod .env — never committed; this repo is public). The HogQL fragment wraps email in `coalesce(person.properties.email, '')` — a NULL email inside `NOT IN` would evaluate to NULL and silently drop anonymous events. The drizzle side does NOT coalesce: it relies on `users.email` / `leads.email` being NOT NULL columns — if `isInternalEmail` is ever applied to a nullable email column, add the coalesce or NULL rows get silently dropped. Only UUID-shaped ids are bound against uuid columns (non-UUID distinct_ids would throw 22P02); non-UUID ids still apply in the HogQL filter. Keep the env lists mirrored with the PostHog "Internal / Test users" cohort (id in memory / PostHog UI). Any new collector or raw analytics query MUST apply these helpers.

`apps/gateway/src/gateway/lifecycle.ts` is the Brevo side of this pipeline: `sendWelcomeEmail()` fires on signup (skips internal emails and no-key state); `runNoActivationFollowup()` is a daily job that selects users older than 3 days with no `firstToolCallAt`, atomically claims each one (same `UPDATE ... WHERE ... IS NULL RETURNING id` pattern) **before** sending, then sends the follow-up template and alerts `#alerts` on send failure. It checks `hasBrevoKey()` before claiming anything — claiming without being able to send would permanently burn the user's one-shot eligibility. `LIFECYCLE_LAUNCH` is a hardcoded cutoff constant so pre-existing users (who got a manual one-off campaign) don't also get the automated flow.

`apps/gateway/src/gateway/user-email.ts` provides `identityProps(email)` — the shared `{ user_email, $set: { email } }` shape spread into every server-side PostHog capture — plus a per-process `Map` cache (`resolveUserIdentity()`) so the tool-call hot path isn't a DB round trip every time.

### Acquisition attribution (server-side events ↔ browser session)

**A server-side capture carries no session id of its own.** PostHog derives channel, campaign and click ids on the *session*, so a `posthog-node` event with no `$session_id` cannot be joined to the browsing session that produced it — it is an orphan with respect to acquisition. Any new server-side event that needs to be attributable must be given one.

The plumbing, three files:

- `apps/gateway/src/lib/attribution.ts` — the wire contract. `ATTRIBUTION_PARAMS` (the `a_*` query-param names), `parseAttribution()` / `toWireParams()`, `deriveChannel()`, and the capture helpers `sessionProps()` (`$session_id`), `acquisitionProps()` (flat `acquisition_*` event properties), `acquisitionSetOnce()` (`$set_once`, because acquisition is a first-touch fact). Pure — no DOM, no express, no SDK. `parseAttribution` normalises two sentinels to null: the SDK's `$direct` no-referrer marker, and — when the caller passes `{ ownHost }` (the express routes pass `req.hostname`) — a SAME-ORIGIN referring domain (SCRUM-87: the SDK stamps its "initial" referrer at first boot, which can happen on an interior page after an internal navigation; an internal navigation must never establish acquisition, and the filter sits at this parse because it is the choke point every producer goes through).
- `apps/gateway/src/components/attribution-links.tsx` — a delegated capture-phase click listener rendered inside `PostHogProvider`. It appends the snapshot to any link into `/auth/google`, `/auth/google/connect`, `/auth/atlassian/connect`. **Adding a new auth-redirect route means adding its path to `ATTRIBUTED_PATHS`** — nothing else needs touching, and no individual link does.
- `apps/gateway/src/gateway/attribution.ts` — the `dtr_attr` cookie (httpOnly, `sameSite: lax`, 15 min) that carries the snapshot through the provider's consent screen, since query params set on the way in are gone by the callback. `stashAttribution()` on the redirect route, `takeAttribution()` first thing in the callback, `persistAcquisition()` on the new-user branch.

Two rules that produce silently *wrong* answers if broken:

1. **Read `posthog.get_session_id()` at the time of the action, never cached at mount.** Sessions roll over on a 30-minute idle timeout and at UTC midnight. A value captured on page load can be stale by the time someone finishes signing up, and stale attribution is worse than none — it is confidently wrong and nothing flags it. `attribution-links.tsx` reads inside the click handler for exactly this reason.
2. **Persist the snapshot on the user record, not just the session id.** A session id joins only while the analytics session row is retained; the `users.acquisition_*` columns survive any retention window. `person_profiles: "identified_only"` stays as it is (a deliberate cost choice), which means person-level `$initial_*` only materialises at identify time — so the session join and the durable columns are the path, not person `$initial_*`.

Client-side captures (`copy_mcp_config`, `wizard_*`, `playground_prompt_run`) already carry `$session_id` from posthog-js and need none of this.

The entry snapshot comes from `posthog.persistence.get_initial_props()`, which derives `$initial_utm_*` / `$initial_gclid` / `$initial_referring_domain` / `$initial_current_url` from the persisted first-touch entry URL + referrer. `posthog.get_property('$initial_utm_source')` does **not** work — persistence stores `$initial_person_info`, and the `$initial_*` keys are derived, not stored.

## Leads & privacy

Leads route: `apps/gateway/src/app/api/leads/route.ts`. Client IP is hashed via `hashIp()` (`sha256(LEADS_IP_SALT:ip)`, env var name only — value lives in SSM) before rate-limiting and storage; only the hash is ever persisted, never the raw IP. Rate limiting (`apps/gateway/src/gateway/leads/limiter.ts`) composes a 3/min and a 10/hour limiter, both keyed by the IP hash. A honeypot field (`website`) is silently accepted without an insert.

**Masking rule is context-dependent, not contradictory:** mask emails when quoting user data into chat/UI-facing output generally. But Slack lead/signup notifications deliberately show the **full** email — this is a founder preference for the team's own users/leads (see `route.ts`'s Slack message construction and `track.ts`'s `trackSignup()`), not an oversight. There is no masking helper anywhere in `apps/gateway/src/gateway/leads/` or `apps/gateway/src/lib/` — that absence is intentional, confirmed by the same policy applying to `db-query`'s output rules. Don't add masking to these call sites without confirming the policy changed.

## Google Ads conversions

`apps/gateway/src/components/google-ads.tsx` loads the gtag global tag site-wide (rendered from the root layout, production-only) and exports one report function per conversion action: `reportLeadConversion()` (fired by the contact form, served at `/contact` — canonical — and its `/demo` alias) and `reportSignupConversion()` (fired by the dashboard when it loads with `?signup=1`, which the Google OAuth callback in `gateway/auth.ts` appends for first-time users; the dashboard strips the param via `history.replaceState` so refreshes can't re-fire). The tag ID is hardcoded (public, client-side anyway); per-action conversion **labels** come from `NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL` / `NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_CONVERSION_LABEL` — each function no-ops until its label is set. `NEXT_PUBLIC_*` vars are inlined at build time, so they're threaded as Docker build args (`apps/gateway/Dockerfile` ARG/ENV pairs + `docker/docker-compose.prod.yml` `build.args`); adding a new one requires all three touchpoints plus `.env.example`. To add a conversion action: create it in Google Ads (Goals → Conversions), add a label env var through those touchpoints, add a `reportXConversion()` wrapper, and call it at the success moment.

## Testing

Copy the HTTP-mock pattern from `apps/gateway/src/lib/brevo.test.ts` and `apps/gateway/src/lib/slack.test.ts` for any new integration:

1. `vi.mock("@datatorag-mcp/config", () => ({ getEnv: () => env }))` with a mutable `env` object declared above the mock, so individual tests can flip keys on/off.
2. `vi.stubGlobal("fetch", fetchMock)` with a `vi.fn()`, reset per test (`vi.clearAllMocks()` / `vi.restoreAllMocks()` in `beforeEach`).
3. Assert on `fetchMock.mock.calls[0]` — destructure `[url, init]`, check `url`, `init.headers`, and `JSON.parse(init.body)`.
4. Always test the no-op branch (missing key/token/channel → `fetch` never called) and the never-throws branch (non-2xx response, and a rejected fetch) explicitly.

Run just this domain's tests: `cd apps/gateway && pnpm vitest run src/lib/brevo.test.ts src/lib/slack.test.ts src/gateway/track.slack.test.ts src/gateway/track.firstcall.test.ts src/gateway/track.feedback.test.ts src/gateway/digest.test.ts src/gateway/lifecycle.test.ts src/gateway/signup-alert.test.ts src/app/api/leads/route.slack.test.ts`
