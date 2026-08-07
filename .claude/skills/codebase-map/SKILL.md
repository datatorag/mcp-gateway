---
name: codebase-map
description: Load FIRST for any datatorag-mcp work — the architecture map. Monorepo layout, gateway request flow, OAuth/token flows, content systems, key decisions with the why, invariants, and a where-things-live index, so you don't re-explore the source.
---

# Codebase Map

Architecture reference for the datatorag-mcp monorepo. Read this instead of re-exploring source. This repo is **public** — no live infrastructure values here; operational details (hosts, profiles, DB project ids) live in private memory (`reference_*` entries) and the `deploy` / `db-query` skills.

## Monorepo layout

pnpm workspace (`pnpm-workspace.yaml`: `apps/*` + `packages/*`), turbo topological builds (`turbo.json`: `build` depends on `^build`). All packages are private ESM built with tsup.

| Package | Role | Internal deps |
|---|---|---|
| `apps/gateway` | The whole product: Express + Next.js server — MCP gateway, OAuth server, marketing site, dashboard, cron jobs | auth, config, db, types |
| `packages/db` | Drizzle schema (15 tables, one file per table under `src/schema/`) + `createDb()` (`prepare: false` for Neon's pooled endpoint); dual exports `.` and `./schema` | none |
| `packages/config` | Single zod env schema; `getEnv()` memoized, `process.exit(1)` on invalid. `DATABASE_URL` is the only var without a default | none |
| `packages/auth` | `hashApiKey`, `safeStringEqual` (constant-time SHA-256 compare), `ApiKeyValidator` (LRU-cached). Consumed only by the OAuth routes | db |
| `packages/types` | zod status enums + `McpGatewayManifest` (the `datatorag.json` plugin manifest shape) | none |

(`packages/docker-manager` used to exist as dead code from the abandoned container-per-plugin design — it was deleted; see decisions.)

## Gateway request flow

```
MCP client
  │ POST /mcp  (Authorization: Bearer <OAuth access token>)
  ▼
apps/gateway/server.ts          validateBearer → oauthAccessTokens (not revoked/expired)
  │                             sessions: in-memory Map keyed by mcp-session-id
  │                             (wiped on every deploy — an unknown session id gets a
  │                             spec-compliant 404 via classifyMcpRequest (mcp-session.ts),
  │                             and clients silently re-initialize on the same bearer; SCRUM-23)
  ▼ new session → createMcpServer(userId, db, pool)
apps/gateway/src/gateway/mcp-server.ts
  │ ListTools: enabled tools ⋈ active mcpServers, filtered to the user's
  │           connected services ("lazy tool loading"); injects `account` param
  │ CallTool:  split tool name on "__" → serverSlug / toolName
  ▼
  ├─ service-mapped plugin → getServiceToken() → ONE-SHOT client,
  │                          token in X-User-Token header (never pooled)
  └─ generic plugin        → ConnectionPool (per-server, max 5, 5min idle,
                             5s acquire timeout, wait-queue)
  ▼ Streamable HTTP → http://<host>:<containerPort>/mcp
plugin child process            spawn("node", entrypoint), ports 40000+
                                managed by src/gateway/plugin-manager.ts
```

- **Auth** happens once per request at `server.ts` (Bearer lookup). Sessions live only in a process-local Map — a restart drops them all; clients must re-initialize.
- **Usage tracking**: every CallTool (success or throw) → `trackToolCall` (`track.ts`) → `classifyOutcome` (`usage/classify.ts`; playground calls and `gws_auth_*` tools unmetered) → `writeUsageEvent` (`usage/write.ts`) racing the insert against a **200ms timeout** so metering never slows the response (events can silently drop). Nightly rollup to `usage_events_daily` + 90-day raw retention in `usage/rollup.ts`.
- **Billing**: `src/gateway/billing/plans.ts` defines caps (`FREE_MONTHLY_CAP` etc.) and is tested — but it is **not wired into the request path**. No cap enforcement gates traffic today.
- Cron jobs run in-process via node-cron, registered in `server.ts`: daily usage rollup (UTC), Slack digest, no-activation follow-up email (both America/Los_Angeles).

## Auth & OAuth flows

Three distinct flows — don't conflate them:

1. **MCP client OAuth** (`src/gateway/oauth/`): a full mini authorization server — `metadata.ts` (RFC 8414 authorization-server metadata, `/.well-known/oauth-authorization-server`) + `protected-resource.ts` (RFC 9728 protected-resource metadata at `/.well-known/oauth-protected-resource`, advertising the `/mcp` resource + this gateway as its authorization server; the `/mcp` 401s carry a `WWW-Authenticate: Bearer resource_metadata="…"` header pointing at it, with `error="invalid_token"` on a bad/expired token), `register.ts` (RFC 7591 dynamic registration; **public clients only** — always `token_endpoint_auth_method: "none"`, PKCE is the protection, no client secret is ever issued/verified), `authorize.ts` (redirects to Google; PKCE + client params round-trip through base64url `state`, which also carries a CSRF nonce matched against an httpOnly cookie at `/oauth/callback`; `redirect_uri` is re-validated against the registered client on callback), `token.ts` (PKCE-verified code grant → 24h access + 60d refresh token), `revoke.ts` (RFC 7009; also fires `onRevoked(userId)` so `server.ts` closes the user's live MCP sessions/SSE streams via `closeSessionsForUser` (mcp-session.ts) — DB-side revocation alone can't reach an already-open stream; still-authorized clients just re-init through the 404 path). Every `/oauth/*` endpoint is per-IP rate-limited (`rate-limit.ts`, mounted on the `/oauth` prefix in `server.ts`), keyed on the un-spoofable Cloudflare `CF-Connecting-IP` header — **not** `X-Forwarded-For` (Cloudflare appends to XFF, so its leftmost entry is client-forgeable) — falling back to the TCP peer when that header is absent. Prod sits behind Cloudflare (TLS terminates there; origin listens on `:80`). Refresh tokens rotate within a `familyId`; presenting an already-revoked token revokes the **whole family** (replay detection) **and its live access tokens** (`grants.ts` `revokeAccessTokensForClient`, scoped to `(userId, clientId)` so `"web"` sessions survive). Refresh lookup is row-locked (`.for("update")`) to serialize concurrent refreshes. Raw refresh tokens are never stored — only sha256 hashes. CSRF-nonce helpers live in `oauth/csrf.ts` (`nonceMatches` + shared TTL).
2. **Dashboard login** (`src/gateway/auth.ts`): `/auth/google` minimal-scope login → `users` row + 1-day session token (stored in `oauthAccessTokens` with `clientId: "web"`) set as httpOnly `dtrmcp_session` cookie. `src/proxy.ts` (Next middleware) gates `/dashboard/*` pages on that cookie.
3. **Service connections** (what plugins actually use): `/auth/google/connect` (full Workspace scopes) and `/auth/atlassian/connect`. Both resolve the user from the `dtrmcp_session` cookie and bind the round-trip with a CSRF nonce (a random value in an httpOnly cookie echoed via OAuth `state`) — the session token is **never** placed in `state`. Provider tokens land in `serviceConnections`; multi-account support layers `connectedAccounts` on top (with `isDefault`). `src/gateway/service-token.ts` resolves the per-user token at call time (`PLUGIN_SERVICE_MAP`: `gws-mcp` → `google-workspace`, `atlassian-mcp` → `atlassian`; anything else routes through legacy `pluginConnections`), refreshes expired tokens via `REFRESH_FN`, and — Atlassian only — persists the **new** refresh token, since Atlassian rotates it on every use. The resolved token is forwarded to the plugin as the `X-User-Token` header.

## Site & content systems

- **Blog / changelog / docs are markdown-in-repo**, not a CMS: content in `apps/gateway/content/{blog,changelog,docs}/*.md`, parsed by three near-identical hand-rolled parsers `src/lib/{blog,changelog,docs}.ts` (gray-matter + `marked.parse`, no MDX). Each keeps a module-level cache populated once per process — content changes need a restart/redeploy to appear.
- **Frontmatter contracts** — field-by-field tables with fallbacks live in the `site-content` skill. Headline facts only: blog `readTime` is computed from word count (not frontmatter); changelog `connector` is convention-only, unvalidated; docs `connector` (not `section`) drives sidebar grouping via `src/lib/docs-connectors.ts` `CONNECTORS` registry — URLs stay flat, e.g. `/docs/gmail`.
- **`/tools/[slug]` is DB-driven**, not markdown: queries `mcpServers`/`tools` directly, 404s unless `status === "active"`, renders the plugin README from the local plugin dir first, then GitHub API fallback (1h revalidate). Home page integrations grid also queries the DB directly.
- **App-router conventions**: no Navbar in root layout — every top-level page renders its own `<Navbar />`; `/docs` and `/dashboard` have their own nested layouts (no Navbar). `components/navbar.tsx` `flatItems` is the single source for desktop + mobile nav. Shipping a new top-level route = page + `flatItems` entry + footer link in `app/page.tsx` (no lint enforces this). Blog/docs use `generateStaticParams`; dashboard pages fetch client-side from rate-limited `/api/usage/*` routes (via `src/lib/with-route.ts` — session auth + rate limit + generic-500 catch-all; every session-gated JSON route uses it).
- **`.prose` typography is hand-rolled** in `src/app/globals.css` — not `@tailwindcss/typography`. No `img` rule; code-block colors are hardcoded hex (duplicated in `tools/[slug]/page.tsx`).

## Key decisions

Big architectural decisions get an ADR page in `docs/architecture/decisions/`
(template there; company decision log lives in the private hq repo). This table is
the quick reference; the ADRs carry context + alternatives-considered.

| Decision | Why | Evidence |
|---|---|---|
| File-based markdown content (blog/changelog/docs) vs DB; `/tools` pages DB-driven | Content is static at deploy time — parse once, cache in-process; tool pages must reflect live plugin registry | `apps/gateway/src/lib/blog.ts` cache comments; commits `5c7f04f`, `f67a24d` |
| Neon serverless Postgres for prod, not docker postgres on the host | Managed DB; prod gateway decoupled from `db-init` so migrations can't block startup; `prepare: false` required for Neon's PgBouncer pooling | commit `a4e56b3`; `packages/db/src/index.ts` |
| Plugins run as host child processes (`spawn`), NOT Docker containers | Simpler than the original container-per-plugin design; the never-imported `packages/docker-manager` vestige was deleted, but the `containerPort` column name still reflects the abandoned model | commit `c9b77f3`; `apps/gateway/src/gateway/plugin-manager.ts` |
| Meta-tool gateway migration: decided direction, **deliberately not executed yet** | Direct tool exposure (~60 tools) is faster/simpler; migrate when catalog crosses ~100 tools. Meanwhile: self-contained tool descriptions, no runtime dependence on the `__` prefix | `docs/architecture/2026-04-22-meta-tool-migration.md` |
| Public POST/DELETE `/api/servers` endpoints removed; plugin installs now via SSH on the host | Unauthenticated plugin management on a public gateway was a security hole | commits `7fb0356`, `f8a6c4f` |
| Per-user-token plugin calls bypass the pool with a one-shot client | Avoids per-user pooling complexity while guaranteeing the right `X-User-Token`; pool stays credential-free | commit `fe083e2`; `user-tools.ts` (`callPluginToolOnce`, consumed by `mcp-server.ts` + playground) |
| `execFileSync` (never `execSync`) for git clone / installs | Prevents shell injection via malicious `githubRepoUrl` | commit `70cc29a` |
| Constant-time compares (`safeStringEqual`) for all PKCE/client_id/redirect_uri checks | CASA Tier 2 SAQ item; part of the passed Google CASA evidence trail | commit `0bbfd7f`; `packages/auth/src/index.ts` |
| Lazy tool loading: ListTools filters by connected services | Keeps the advertised tool list honest about what the user can actually call | commit `d2d45ee` |
| Slack via `chat.postMessage` bot token, not webhooks | Reuses the existing "Dara" Slack app; one token + channel-id env vars instead of three webhook URLs | commit `a426a0a`; `src/lib/slack.ts` |

## Invariants & gotchas

- **Two same-named `plugin-manager.ts` files**: `apps/gateway/src/lib/plugin-manager.ts` is the 22-line `getPluginManager()` singleton accessor (globalThis-based for Next hot-reload); `apps/gateway/src/gateway/plugin-manager.ts` is the actual 500-line `PluginManager` class. Easy to open the wrong one.
- **`startAll()` does not re-discover tools** — it only respawns processes for `status: "active"` servers. `discoverTools()` runs only during install/reinstall. A plugin whose tool set changed needs a reinstall, not a gateway restart.
- **`discoverTools()` deletes all `tools` rows for a server, then reinserts** — and `tools.enabled` defaults `true` (`packages/db/src/schema/tools.ts`), so reinstalling a plugin resets any manually-disabled tool to enabled. Mid-reinstall, ListTools can briefly see an empty tool set for that server.
- **`/api/servers` is session-auth-gated** (GET included); the public POST/DELETE install/uninstall endpoints no longer exist. Plugin reinstalls require SSH to the gateway host (see the `deploy` skill).
- **Dev server port comes from the root `.env`** (`GATEWAY_PORT`) — `pnpm dev` runs `node --env-file=../../.env`. It is NOT Next's default 3000 (dev compose publishes 8285).
- **Billing caps are defined but unenforced** — `billing/plans.ts` is referenced only by its own test. Don't assume free-tier limits gate traffic.
- **MCP sessions are in-memory only** — every deploy/restart drops all live client sessions.
- **`ConnectionPool` is per-server, shared across all users** — it must never carry a per-user credential; that's the whole reason for the one-shot-client bypass. Preserve this split when touching plugin call paths.
- **Date rendering convention**: always parse `YYYY-MM-DD` frontmatter dates as `new Date(\`${date}T00:00:00\`)` (never bare `new Date(date)`, which is UTC midnight and shows the previous day west of UTC). Changelog, blog listing, and blog post pages all follow this now — keep any new date-rendering page consistent.
- **Migration `0004` numbering collision** in `packages/db/drizzle/`: hand-written `0004_leads.sql` (outside drizzle's journal) coexists with drizzle-generated `0004_smiling_hercules.sql` (in the journal). The only documentation is a SQL comment at the top of `0004_smiling_hercules.sql`. Be careful interpreting `drizzle-kit generate` diffs around the `leads` table.
- **`getEnv()` hard-exits on invalid env** (`process.exit(1)`), at first call — not import — so a bad `DATABASE_URL` can kill the process mid-request-path rather than at boot.
- **Dev compose doesn't forward Slack/Brevo/PostHog-server vars** into the container (prod compose does) — those features silently no-op in dev even with the var in `.env`. Empty `SLACK_BOT_TOKEN`/`BREVO_API_KEY` = intentional logged no-op, not a bug. Stripe is the exception: `getStripe()` throws on a missing key.
- **Usage metering is best-effort** (200ms insert timeout) — anything built on `usage_events` must tolerate undercounting. Stored error messages are PII-scrubbed by `usage/redact.ts` (emails, long IDs) — expect `[redacted-*]` artifacts.
- **`__` is the load-bearing tool-name separator** (`NAMESPACE_SEPARATOR`): CallTool splits on the first occurrence. A slug or tool name containing `__` misroutes.
- **Server-side events cannot be attributed without a session id** — a `posthog-node` capture carries none of its own, so it can't be joined to the browsing session that produced it. New server-side events that need to be attributable must spread `sessionProps()` (`src/lib/attribution.ts`); new auth-redirect routes must be added to `ATTRIBUTED_PATHS` in `src/components/attribution-links.tsx` and must `stashAttribution`/`takeAttribution` across the provider round-trip. The session id is read at click time, never cached at mount (sessions roll over on idle timeout and at UTC midnight — a cached one is confidently wrong and nothing flags it). Full pattern in the `services-integrations` skill.
- **Never-throw convention** for side channels: `sendSlack`, `brevoPost`, all analytics/track functions catch internally and warn with a `[module]` log prefix. Exactly-once side effects use atomic `UPDATE … WHERE <flag> IS NULL RETURNING id` claims (`first_tool_call_at`, follow-up emails).
- **Content parser caches never invalidate** — editing markdown does nothing on a running prod server; redeploy.
- **Playground is unmetered by design** — the dashboard playground (`src/gateway/playground/`) never writes `usage_events` and never sets `first_tool_call_at`; activation must keep meaning "a real MCP client called through the gateway". Its lifetime message cap uses a guarded-UPDATE claim/refund on `users.playground_messages_used` (details in the `services-integrations` skill's Playground section).
- **Playground writes are user-gated, fail-closed** — the Mastra agent runtime pauses for approval on any tool whose `requireApproval` is true, and that flag is set from `classifyWrite` (`playground/tools.ts`) in `src/mastra/mcp/client.ts`. Classification is decided from the tool's NAME and source-resident lists only — the MCP `readOnlyHint` annotation is deliberately NOT consulted (a server could mark a destructive tool read-only and walk past the prompt; that path was deleted with the Mastra rebuild). Decision order: `ALWAYS_WRITE_TOOLS` escalation → write-verb token floor (`isWriteTool`, raise-only, nothing can dig under it) → `KNOWN_READ_TOOLS` allowlist (the reviewed set of tools that run unprompted) → default WRITE (unrecognised names fail closed and prompt). **Shipping a new tool therefore requires classifying it in the same commit**: add it to the snapshot in `playground/tool-classification.test.ts` and, if it's a read, to `KNOWN_READ_TOOLS` — a test asserts those two lists agree, and a DB-backed test (runs when `DATABASE_URL` is present; vitest.config seeds it from the root `.env`) asserts the snapshot covers the live registry. A missing entry doesn't create a security hole, it creates an unnecessary approval prompt.
- **`connection-tester.tsx` is GONE** — the dashboard's connection tester was absorbed into `src/app/dashboard/setup-wizard.tsx` (which kept its `/api/setup/status` polling). Don't look for it; old references mean the wizard now.
- **Relative imports in `apps/gateway` are extensionless** (`from "../lib/slack"`, never `"../lib/slack.js"`). tsconfig `moduleResolution: "bundler"` makes extensionless valid for every consumer — tsc, the tsx dev runtime, tsup, Next's webpack prod build, AND Turbopack (`pnpm dev`). `.js`-suffixed relative specifiers were normalized away after they broke the Turbopack dev server for any app route transitively importing `gateway/*.ts` (a webpack-only `extensionAlias` workaround existed briefly and was removed — webpack's hook doesn't apply to Turbopack, so it fixed prod while dev stayed broken). Package-subpath imports keep their extensions (e.g. `@modelcontextprotocol/sdk/client/index.js`). Don't reintroduce `.js` relative specifiers.
- **The testcontainers harness is live** — `src/test-utils/db.ts` (real Postgres via `@testcontainers/postgresql`, runs drizzle migrations) has a real consumer: `src/app/api/setup/status/route.liveness.test.ts`. Suites using it must gate on `isDockerAvailable()` (`describe.skipIf`, probed synchronously at import time) so `pnpm vitest run` still passes on machines/CI without a Docker daemon — and must never call `getTestDb()` at module-import time, only inside the gated block's `beforeAll`.

## Quality pass — design-time, not post-hoc

Do NOT run agent-fan-out review passes (`/simplify`-style, 4 parallel agents) on
every change by default — that burns tokens re-discovering what a 60-second
design check catches up front. Instead, before implementing, answer these four
questions inline (in the plan or in your head, one grep each) and let the
answers shape the code:

1. **Reuse** — does a helper for this already exist? Grep shared modules
   (`response.ts` in gws-mcp, `src/lib/` + `src/gateway/usage/` here) and the
   file you're editing's neighbors before writing a new one. If you find a
   near-match, promote it to the shared module rather than copying it.
2. **Source of truth** — if the change displays or derives data that exists
   elsewhere (docs frontmatter, DB, a registry), read it from there; never
   hand-copy values that will drift.
3. **Altitude** — is this a special case layered on shared infrastructure? If
   the same problem exists for sibling tools/routes, fix the shared layer once.
4. **Efficiency** — anything hot-path, per-request, or per-item that could be
   hoisted, batched, or skipped early?

Reserve the agent fan-out review for when the user asks for it, or for large
multi-file changes where a fresh-eyes sweep genuinely pays for itself.

## Where things live

| Task | Path |
|---|---|
| `/mcp` endpoint, session Map, Bearer validation, cron schedules, boot order | `apps/gateway/server.ts` |
| ListTools/CallTool logic, tool routing, one-shot vs pooled clients | `apps/gateway/src/gateway/mcp-server.ts` |
| Plugin install/spawn/respawn/health/discoverTools (the class) | `apps/gateway/src/gateway/plugin-manager.ts` |
| PluginManager singleton accessor | `apps/gateway/src/lib/plugin-manager.ts` |
| Backend MCP connection pool | `apps/gateway/src/gateway/pool.ts` |
| OAuth server (discovery/register/authorize/token/revoke) | `apps/gateway/src/gateway/oauth/*.ts` |
| Dashboard login + service-connect OAuth (Google, Atlassian) | `apps/gateway/src/gateway/auth.ts` |
| Per-user service token resolution + refresh (`PLUGIN_SERVICE_MAP`, `REFRESH_FN`) | `apps/gateway/src/gateway/service-token.ts` |
| Multi-account list/default/disconnect | `apps/gateway/src/gateway/connected-accounts.ts` |
| Dashboard page gating (`dtrmcp_session`) | `apps/gateway/src/proxy.ts` |
| Plan caps (unwired) | `apps/gateway/src/gateway/billing/plans.ts` |
| Usage: classify / write / redact / rollup / ranges / rate-limit | `apps/gateway/src/gateway/usage/` |
| PostHog events, signup/first-call tracking | `apps/gateway/src/gateway/track.ts` |
| Identity cache + `identityProps` for captures | `apps/gateway/src/gateway/user-email.ts` |
| Acquisition attribution: wire contract + channel derivation | `apps/gateway/src/lib/attribution.ts` |
| Acquisition attribution: `dtr_attr` cookie stash + user-record persist | `apps/gateway/src/gateway/attribution.ts` |
| Acquisition attribution: click-time link decorator (`ATTRIBUTED_PATHS`) | `apps/gateway/src/components/attribution-links.tsx` |
| Daily Slack digest (Neon/Stripe/PostHog collectors) | `apps/gateway/src/gateway/digest.ts` |
| Brevo welcome + no-activation follow-up emails | `apps/gateway/src/gateway/lifecycle.ts` |
| Slack / Brevo / Stripe / PostHog-server clients | `apps/gateway/src/lib/{slack,brevo,stripe,posthog-server}.ts` |
| Session cookie → userId | `apps/gateway/src/lib/session.ts` |
| Playground agentic loop (8-iteration cap, prompt caching, system prompt) | `apps/gateway/src/gateway/playground/engine.ts` |
| Playground tool listing/execution (thin shaping over shared `user-tools.ts`) | `apps/gateway/src/gateway/playground/tools.ts` |
| Shared "which tools can this user see" policy + plugin URL + one-shot call | `apps/gateway/src/gateway/user-tools.ts` |
| Playground message-cap claim/refund (`users.playground_messages_used`) | `apps/gateway/src/gateway/playground/cap.ts` |
| Playground SSE chat + feedback routes (401/403/429/400 mapping) | `apps/gateway/src/app/api/playground/{chat,feedback}/route.ts` |
| Playground LLM model factory (Anthropic) | `apps/gateway/src/lib/llm.ts` |
| Playground chat UI (`PlaygroundHandle.runPrompt`, feedback controls) | `apps/gateway/src/app/dashboard/playground.tsx` |
| Setup wizard (client picker, config snippets, live status polling) | `apps/gateway/src/app/dashboard/setup-wizard.tsx` |
| Setup status API (live non-"web" tokens only — not revoked/expired) | `apps/gateway/src/app/api/setup/status/route.ts` |
| Testcontainers Postgres helper + `isDockerAvailable()` gate | `apps/gateway/src/test-utils/db.ts` |
| Leads intake (zod, honeypot, IP hash, own limiters) | `apps/gateway/src/app/api/leads/route.ts`, `apps/gateway/src/gateway/leads/limiter.ts` |
| Blog / changelog / docs parsers | `apps/gateway/src/lib/{blog,changelog,docs}.ts` |
| Docs connector grouping registry | `apps/gateway/src/lib/docs-connectors.ts` |
| Content markdown | `apps/gateway/content/{blog,changelog,docs}/*.md` |
| Tool detail page (DB + README fallback) | `apps/gateway/src/app/tools/[slug]/page.tsx` |
| Home page (DB-driven integrations grid, footer links) | `apps/gateway/src/app/page.tsx` |
| Navbar (`flatItems` — desktop + mobile nav source of truth) | `apps/gateway/src/components/navbar.tsx` |
| Per-service brand icons (`ServiceIcon`, `serviceFromToolName`/`serviceFromSlug`; assets + provenance in `public/icons/services/`) | `apps/gateway/src/components/service-icon.tsx` |
| Hand-rolled `.prose` styles | `apps/gateway/src/app/globals.css` |
| Session-auth + rate-limit + error-envelope API wrapper | `apps/gateway/src/lib/with-route.ts` |
| DB client factory + schema barrel | `packages/db/src/index.ts`, `packages/db/src/schema/index.ts` |
| Migrations + journal | `packages/db/drizzle/` |
| Env schema / `getEnv()` | `packages/config/src/index.ts` |
| Constant-time compare, API-key hashing | `packages/auth/src/index.ts` |
| Plugin manifest type, status enums | `packages/types/src/index.ts` |
| Dev / prod compose topology | `docker/docker-compose.dev.yml`, `docker/docker-compose.prod.yml` |
| SSM → `.env` render script | `scripts/render-env.sh` |
| Env var names + SSM flow docs | `.env.example` |
| Meta-tool migration decision doc | `docs/architecture/2026-04-22-meta-tool-migration.md` |
| Architecture decision records (ADRs) | `docs/architecture/decisions/` (TEMPLATE.md there) |

## Commands

- Tests: `pnpm vitest run` (in `apps/gateway`) · Typecheck: `pnpm exec tsc --noEmit` · Build: `pnpm build`
- Dev: `pnpm dev:gateway`; or in `apps/gateway`: `pnpm dev`. There is no local postgres — `DATABASE_URL` points at a Neon branch, and nothing migrates on boot.
- Migrations: `pnpm --filter @datatorag-mcp/db db:generate` / `db:migrate` (`db:push` is dev-only)
- Deploys and DB queries: use the `deploy` and `db-query` skills — infra specifics live there and in private memory.
