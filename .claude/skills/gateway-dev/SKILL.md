---
name: gateway-dev
description: Use when adding or changing gateway functionality in datatorag-mcp — API routes, dashboard pages, gateway capabilities, usage/billing events, DB schema. Recipes with file paths and wiring steps, plus test patterns and the ship ritual.
---

# Gateway Dev

## Before you start

Load the `codebase-map` skill first — this skill assumes you already know the request flow, the two `plugin-manager.ts` files, and the invariants list. It doesn't repeat any of that; it's recipes only.

## Recipes

### Add an API route (dashboard-authenticated)

Dashboard endpoints live under `apps/gateway/src/app/api/**/route.ts` and reuse the shared wrapper rather than hand-rolling auth:

1. Create `route.ts`, export `dynamic = "force-dynamic"` if the response must never be statically cached (every existing usage route does this).
2. Wrap the handler in `withRoute` (`apps/gateway/src/lib/with-route.ts`, replaced `with-rate-limit.ts` in the DRY-1 refactor) — it resolves the session via `getSessionUserId` (`apps/gateway/src/lib/session.ts`), 401s `{error:"Unauthorized"}` if absent, checks `dashboardApiLimiter` (`apps/gateway/src/gateway/usage/rate-limit.ts`) → 429, and maps any unhandled throw to a generic 500 via `logAndGenericError` (`apps/gateway/src/lib/errors.ts`) so a raw `Error.message` never reaches a client. Handler shape is `(userId, req, ctx) => Promise<Response>`; for `[slug]` routes pass the ctx type: `withRoute<{ params: Promise<{slug: string}> }>(...)`. Every session-gated JSON route uses it — the only exceptions are the two OAuth connect/callback redirect flows (bespoke CSRF-cookie handling).
3. Query through `db` (`apps/gateway/src/lib/db.ts`), not a fresh `createDb()` call.
4. Return `NextResponse.json(...)`. See `apps/gateway/src/app/api/usage/summary/route.ts` for the full shape (session → rate limit → drizzle aggregate query → JSON):

```ts
export const dynamic = "force-dynamic";

export const GET = withRoute(async (userId) => {
  const rows = await db.select({ /* ... */ }).from(usageEvents)
    .where(eq(usageEvents.userId, userId));
  return NextResponse.json({ /* ... */ });
});
```

### Add an API route (public, unauthenticated)

For public-facing endpoints (lead capture, webhooks) follow `apps/gateway/src/app/api/leads/route.ts` instead: its own dedicated limiters (`leadsMinuteLimiter`/`leadsHourLimiter` in `apps/gateway/src/gateway/leads/limiter.ts`, same `createRateLimiter` primitive as `dashboardApiLimiter`), a zod `bodySchema` with a honeypot field, and IP hashing (`createHash("sha256")` salted with `LEADS_IP_SALT` from `getEnv()`) instead of storing raw IPs. Client IP comes from `CF-Connecting-IP` first (prod is behind Cloudflare with the origin firewalled to CF ranges); the leftmost `X-Forwarded-For` entry is client-spoofable and only a dev fallback — any new public endpoint must use the same order.

### Add a gateway capability (mcp-server.ts)

`apps/gateway/src/gateway/mcp-server.ts` builds one MCP `Server` per session with two handlers — most new capabilities touch one of these paths:

1. **New built-in tool** (like `echo` / `list_connected_accounts`, no plugin process involved): add an entry to the `BUILT_IN_TOOLS` registry in that file — definition plus handler in one object. The registry drives ListTools, CallTool dispatch, AND `tool_call` emission with `builtin: true` (metered:false, no billing sink, no activation claim), so an entry inherits correct tracking by construction; do NOT hand-roll an inline `if (name === ...)` branch, which is exactly how the two originals shipped emitting nothing (f-050). `mcp-server.builtins.test.ts` iterates the registry, so a new entry is test-covered automatically.
2. **New connector/service gating**: add an entry to `PLUGIN_SERVICE_MAP` in `apps/gateway/src/gateway/service-token.ts` (plugin slug → connector-type string). This is what makes the shared tool-visibility policy (`listUserToolRows` in `apps/gateway/src/gateway/user-tools.ts`, consumed by both `ListTools` and the playground) filter that plugin's tools until the user has connected the service ("lazy tool loading"), and what routes `CallTool` through `getServiceToken` instead of the legacy `pluginConnections` path.
3. If the new service needs token refresh, add a matching function to `REFRESH_FN` in `service-token.ts` — model it on `refreshGoogleToken`/`refreshAtlassianToken`; if the provider rotates refresh tokens on every use (Atlassian does, Google doesn't), the refresh function must persist the new one.
4. **New OAuth-connect provider** for a service: mirror the Google/Atlassian pair in `apps/gateway/src/gateway/auth.ts` — a scopes const (like `GWS_SCOPES`/`ATLASSIAN_SCOPES`) plus a `/auth/<provider>/connect` route + callback, gated on the `dtrmcp_session` cookie.
5. Whatever you add, every `CallTool` path — success or throw — must still end in a `trackToolCall` call so usage accounting doesn't silently stop for the new capability (see next recipe).

### Add a usage event

Two different things share the name "usage event" here — pick the right one:

1. **A new analytics event** (PostHog): add a key to `EVENTS` in `apps/gateway/src/lib/analytics.ts`, then `capture()` it via `getPosthog()` spreading `...identityProps(userEmail)` so it's attributable to a real user.
2. Follow the never-throw convention for the capture call: wrap it in try/catch, log with a `console.warn`/`console.error` `[module]`-prefixed message on failure, never let it propagate out of the request path.
3. If the event marks a one-time milestone (like a first-use flag), use the idempotent claim pattern instead of a plain check-then-write: `UPDATE ... WHERE <flag> IS NULL RETURNING id`, then only capture if the returned row set is non-empty. See `trackFirstToolCall` in `apps/gateway/src/gateway/track.ts` for the full shape.
4. **A new billable/metered `usage_events` row** is a different thing — this happens automatically for every tool call via `trackToolCall` → `classifyOutcome` (`apps/gateway/src/gateway/usage/classify.ts`) → `writeUsageEvent` (`apps/gateway/src/gateway/usage/write.ts`, races a 200ms timeout — tolerate drops, they're logged not retried). To change what counts as metered, edit `classify.ts` (the `NON_METERED_TOOLS` list for named tools; gateway built-ins are unmetered structurally via the `builtin` flag their dispatch path sets — they emit the event, SCRUM-66, but never reach a billing sink); to change what's persisted, edit `write.ts` and the `usageEvents` schema (see DB recipe below) together, since the insert shape and the table columns must stay in sync.

### Add a billing hook

Billing today is **plan-limit definitions with no enforcement wired in** — `apps/gateway/src/gateway/billing/plans.ts` (`planLimits`, `isOverage`, `FREE_MONTHLY_CAP`, `PRO_MONTHLY_INCLUDED`) is referenced only by its own test. There's no existing hook to "extend" — adding real enforcement is new integration work:

1. Read the user's plan from the `subscriptions` table (`packages/db/src/schema/subscriptions.ts` — `status`, `stripePriceId`, `currentPeriodEnd`) rather than assuming a single global plan.
2. Call `planLimits(plan)` / `isOverage(plan, callsUsed)` from `billing/plans.ts` at the point you want to gate — e.g. inside `CallToolRequestSchema` before dispatching, or inside `trackToolCall` after `classifyOutcome`. Decide explicitly whether over-cap is a hard stop (`hardCap: true`) or metered overage.
3. For usage-threshold notifications (80/100/150%), reuse the dedupe pattern already modeled by the `alert_sends` table (`packages/db/src/schema/alert-sends.ts` — composite PK on `(userId, periodStart, thresholdPct)` so a resend is a no-op insert conflict) even though nothing currently writes to it.
4. Stripe API access goes through `getStripe()` / `ensureStripeCustomer()` in `apps/gateway/src/lib/stripe.ts` — it's the only client that throws (not no-ops) on a missing key, so guard calls accordingly in dev.

### Add or modify a DB table

Schema is one table per file under `packages/db/src/schema/`, drizzle-orm `pgTable`:

1. Add `packages/db/src/schema/<name>.ts` (or edit an existing table file) following the shape in `packages/db/src/schema/usage.ts` — `uuid("id").primaryKey().defaultRandom()`, explicit `references(() => users.id, { onDelete: "cascade" })` for FKs, `index(...)` array as the third `pgTable` arg.
2. Add an `export * from "./<name>"` (or named export) line to the barrel `packages/db/src/schema/index.ts` — nothing is picked up otherwise.
3. Generate a migration: `pnpm --filter @datatorag-mcp/db db:generate` (diffs schema into new SQL under `packages/db/drizzle/`, and registers it in `packages/db/drizzle/meta/_journal.json`). Use `db:push` only for throwaway local iteration, never for anything you intend to commit.
4. Apply it: `pnpm --filter @datatorag-mcp/db db:migrate`.
5. Watch for the `0004` numbering collision already in this repo (`packages/db/drizzle/0004_leads.sql` is hand-written and outside the journal, alongside journaled `0004_smiling_hercules.sql`) — don't assume every file matching the next-expected prefix is un-applied; check the journal, not just the filename.

## Testing patterns

Test files sit next to the module they cover (`*.test.ts`, e.g. `apps/gateway/src/gateway/lifecycle.test.ts`, `apps/gateway/src/gateway/track.firstcall.test.ts`, `apps/gateway/src/gateway/billing/plans.test.ts`, `apps/gateway/src/app/api/leads/route.slack.test.ts`) — no separate `__tests__` tree.

The dominant pattern across the gateway/lib/app-route suites is **hand-rolled mocks, not a real database**:

- `vi.mock` every side-effecting module (`../lib/slack.js`, `../lib/brevo.js`, `../lib/posthog-server.js`, `@datatorag-mcp/config`, `@/lib/session`, `@/lib/db`) at the top of the file, before importing the module under test.
- The DB is a chainable stub built from `vi.fn()`, e.g. `{ from: () => ({ where: selectWhere }) }` (see `lifecycle.test.ts`) or a small `chainable(result)` helper that makes every drizzle method (`from`/`where`/`leftJoin`/`orderBy`/`limit`) resolve to a queued value in call order (see `apps/gateway/src/app/api/setup/status/route.test.ts`).
- `beforeEach(() => vi.clearAllMocks())`, then re-seed default mock return values per test.
- Assert side effects with `expect(x).toHaveBeenCalledWith(expect.objectContaining({...}))` / `expect.stringContaining(...)`, not exact deep equality, so unrelated property additions don't break tests.
- `digest.test.ts` uses `vi.stubGlobal("fetch", fetchMock)` / `vi.unstubAllGlobals()` in `afterEach` to test the "integration not configured" short-circuit without a network call.

A **testcontainers-based real-Postgres helper exists** (`apps/gateway/src/test-utils/db.ts`, `@testcontainers/postgresql` + `drizzle-orm/postgres-js/migrator`, spins up `postgres:16-alpine` and runs the real migrations folder) but nothing currently imports it — it's available scaffolding for a true integration test, not a pattern you'll find already in use. Reach for the mock style above unless you specifically need to exercise real SQL (e.g. a migration or a query with joins/aggregates you don't trust a stub to represent).

## Commands

- Tests: `pnpm vitest run` (in `apps/gateway`)
- Typecheck: `pnpm exec tsc --noEmit` (in `apps/gateway` — there's no root `tsconfig.json`, so this must run from inside the package)
- Build (root): `pnpm build`
- Dev server: `pnpm dev` in `apps/gateway` (no local postgres to start first — `DATABASE_URL` in the root `.env` points at a Neon branch). Port comes from the root `.env` (`GATEWAY_PORT`) — not Next's default 3000.

## Ship ritual

1. Branch off `main`.
2. Tests + typecheck + build all pass (`pnpm vitest run` in `apps/gateway`, `pnpm exec tsc --noEmit`, `pnpm build`).
3. Content-coverage check: run the `content-marketer` agent if the change touches anything user-facing (new route, new capability, changed billing behavior) that should be reflected in docs/changelog/blog.
4. Run the `security-reviewer` agent (`.claude/agents/security-reviewer.md`) on `origin/main...HEAD` — this repo is public, this gate is mandatory, not optional. Only proceed on `VERDICT: PASS`.
5. `gh auth status` — confirm the org account, not a personal one, before pushing.
6. Push.
7. If prod-bound, use the `deploy` skill — don't hand-roll SSH/rebuild steps here.
