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
| `packages/docker-manager` | **Dead code** — never imported anywhere. Plugins do NOT run in Docker (see decisions) | none |

## Gateway request flow

```
MCP client
  │ POST /mcp  (Authorization: Bearer <OAuth access token>)
  ▼
apps/gateway/server.ts          validateBearer → oauthAccessTokens (not revoked/expired)
  │                             sessions: in-memory Map keyed by mcp-session-id
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

1. **MCP client OAuth** (`src/gateway/oauth/`): a full mini authorization server — `metadata.ts` (RFC 9728 discovery), `register.ts` (RFC 7591 dynamic registration, PKCE public clients), `authorize.ts` (redirects to Google; PKCE + client params round-trip through base64url `state`), `token.ts` (PKCE-verified code grant → 24h access + 60d refresh token), `revoke.ts` (RFC 7009). Refresh tokens rotate within a `familyId`; presenting an already-revoked token revokes the **whole family** (replay detection). Refresh lookup is row-locked (`.for("update")`) to serialize concurrent refreshes. Raw refresh tokens are never stored — only sha256 hashes.
2. **Dashboard login** (`src/gateway/auth.ts`): `/auth/google` minimal-scope login → `users` row + 1-day session token (stored in `oauthAccessTokens` with `clientId: "web"`) set as httpOnly `dtrmcp_session` cookie. `src/proxy.ts` (Next middleware) gates `/dashboard/*` pages on that cookie.
3. **Service connections** (what plugins actually use): `/auth/google/connect` (full Workspace scopes) and `/auth/atlassian/connect` (session token passed through OAuth `state` because Atlassian's redirect may lose cookie context). Provider tokens land in `serviceConnections`; multi-account support layers `connectedAccounts` on top (with `isDefault`). `src/gateway/service-token.ts` resolves the per-user token at call time (`PLUGIN_SERVICE_MAP`: `gws-mcp` → `google-workspace`, `atlassian-mcp` → `atlassian`; anything else routes through legacy `pluginConnections`), refreshes expired tokens via `REFRESH_FN`, and — Atlassian only — persists the **new** refresh token, since Atlassian rotates it on every use. The resolved token is forwarded to the plugin as the `X-User-Token` header.

## Site & content systems

- **Blog / changelog / docs are markdown-in-repo**, not a CMS: content in `apps/gateway/content/{blog,changelog,docs}/*.md`, parsed by three near-identical hand-rolled parsers `src/lib/{blog,changelog,docs}.ts` (gray-matter + `marked.parse`, no MDX). Each keeps a module-level cache populated once per process — content changes need a restart/redeploy to appear.
- **Frontmatter contracts** (fallbacks in parens): blog — `title` (slug), `excerpt` (""), `date` (today), `author` ("DataToRAG"), optional `authorImage/category/ogImage/coverImage`, `tags` ([]); `readTime` is computed from word count, not frontmatter. changelog — `title`, `date`, `tags`, optional `connector` (unvalidated). docs — `title`, `description`, `order` (99 = sorts last), `section` ("general"), `connector` (null; drives sidebar grouping via `src/lib/docs-connectors.ts` `CONNECTORS` registry — URLs stay flat, e.g. `/docs/gmail`).
- **`/tools/[slug]` is DB-driven**, not markdown: queries `mcpServers`/`tools` directly, 404s unless `status === "active"`, renders the plugin README from the local plugin dir first, then GitHub API fallback (1h revalidate). Home page integrations grid also queries the DB directly.
- **App-router conventions**: no Navbar in root layout — every top-level page renders its own `<Navbar />`; `/docs` and `/dashboard` have their own nested layouts (no Navbar). `components/navbar.tsx` `flatItems` is the single source for desktop + mobile nav. Shipping a new top-level route = page + `flatItems` entry + footer link in `app/page.tsx` (no lint enforces this). Blog/docs use `generateStaticParams`; dashboard pages fetch client-side from rate-limited `/api/usage/*` routes (via `src/lib/with-rate-limit.ts`, which also does session auth).
- **`.prose` typography is hand-rolled** in `src/app/globals.css` — not `@tailwindcss/typography`. No `img` rule; code-block colors are hardcoded hex (duplicated in `tools/[slug]/page.tsx`).

## Key decisions

| Decision | Why | Evidence |
|---|---|---|
| File-based markdown content (blog/changelog/docs) vs DB; `/tools` pages DB-driven | Content is static at deploy time — parse once, cache in-process; tool pages must reflect live plugin registry | `apps/gateway/src/lib/blog.ts` cache comments; commits `5c7f04f`, `f67a24d` |
| Neon serverless Postgres for prod, not docker postgres on the host | Managed DB; prod gateway decoupled from `db-init` so migrations can't block startup; `prepare: false` required for Neon's PgBouncer pooling | commit `a4e56b3`; `packages/db/src/index.ts` |
| Plugins run as host child processes (`spawn`), NOT Docker containers | Simpler than the original container-per-plugin design; `packages/docker-manager` and the `containerPort` column name are vestiges of the abandoned model | commit `c9b77f3`; `apps/gateway/src/gateway/plugin-manager.ts` |
| Meta-tool gateway migration: decided direction, **deliberately not executed yet** | Direct tool exposure (~60 tools) is faster/simpler; migrate when catalog crosses ~100 tools. Meanwhile: self-contained tool descriptions, no runtime dependence on the `__` prefix | `docs/architecture/2026-04-22-meta-tool-migration.md` |
| Public POST/DELETE `/api/servers` endpoints removed; plugin installs now via SSH on the host | Unauthenticated plugin management on a public gateway was a security hole | commits `7fb0356`, `f8a6c4f` |
| Per-user-token plugin calls bypass the pool with a one-shot client | Avoids per-user pooling complexity while guaranteeing the right `X-User-Token`; pool stays credential-free | commit `fe083e2`; `mcp-server.ts` |
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
- **Blog date formatting has a latent TZ bug**: changelog parses dates as `new Date(\`${date}T00:00:00\`)` to avoid the UTC-midnight day-shift; `app/blog/page.tsx` and `app/blog/[slug]/page.tsx` do `new Date(post.date)` directly — west-of-UTC browsers can show the previous day. Don't copy the blog pattern; copy changelog's.
- **Migration `0004` numbering collision** in `packages/db/drizzle/`: hand-written `0004_leads.sql` (outside drizzle's journal) coexists with drizzle-generated `0004_smiling_hercules.sql` (in the journal). The only documentation is a SQL comment at the top of `0004_smiling_hercules.sql`. Be careful interpreting `drizzle-kit generate` diffs around the `leads` table.
- **`getEnv()` hard-exits on invalid env** (`process.exit(1)`), at first call — not import — so a bad `DATABASE_URL` can kill the process mid-request-path rather than at boot.
- **Dev compose doesn't forward Slack/Brevo/PostHog-server vars** into the container (prod compose does) — those features silently no-op in dev even with the var in `.env`. Empty `SLACK_BOT_TOKEN`/`BREVO_API_KEY` = intentional logged no-op, not a bug. Stripe is the exception: `getStripe()` throws on a missing key.
- **Usage metering is best-effort** (200ms insert timeout) — anything built on `usage_events` must tolerate undercounting. Stored error messages are PII-scrubbed by `usage/redact.ts` (emails, long IDs) — expect `[redacted-*]` artifacts.
- **`__` is the load-bearing tool-name separator** (`NAMESPACE_SEPARATOR`): CallTool splits on the first occurrence. A slug or tool name containing `__` misroutes.
- **Never-throw convention** for side channels: `sendSlack`, `brevoPost`, all analytics/track functions catch internally and warn with a `[module]` log prefix. Exactly-once side effects use atomic `UPDATE … WHERE <flag> IS NULL RETURNING id` claims (`first_tool_call_at`, follow-up emails).
- **Content parser caches never invalidate** — editing markdown does nothing on a running prod server; redeploy.

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
| Daily Slack digest (Neon/Stripe/PostHog collectors) | `apps/gateway/src/gateway/digest.ts` |
| Brevo welcome + no-activation follow-up emails | `apps/gateway/src/gateway/lifecycle.ts` |
| Slack / Brevo / Stripe / PostHog-server clients | `apps/gateway/src/lib/{slack,brevo,stripe,posthog-server}.ts` |
| Session cookie → userId | `apps/gateway/src/lib/session.ts` |
| Leads intake (zod, honeypot, IP hash, own limiters) | `apps/gateway/src/app/api/leads/route.ts`, `apps/gateway/src/gateway/leads/limiter.ts` |
| Blog / changelog / docs parsers | `apps/gateway/src/lib/{blog,changelog,docs}.ts` |
| Docs connector grouping registry | `apps/gateway/src/lib/docs-connectors.ts` |
| Content markdown | `apps/gateway/content/{blog,changelog,docs}/*.md` |
| Tool detail page (DB + README fallback) | `apps/gateway/src/app/tools/[slug]/page.tsx` |
| Home page (DB-driven integrations grid, footer links) | `apps/gateway/src/app/page.tsx` |
| Navbar (`flatItems` — desktop + mobile nav source of truth) | `apps/gateway/src/components/navbar.tsx` |
| Hand-rolled `.prose` styles | `apps/gateway/src/app/globals.css` |
| Session-auth + rate-limit API wrapper | `apps/gateway/src/lib/with-rate-limit.ts` |
| DB client factory + schema barrel | `packages/db/src/index.ts`, `packages/db/src/schema/index.ts` |
| Migrations + journal | `packages/db/drizzle/` |
| Env schema / `getEnv()` | `packages/config/src/index.ts` |
| Constant-time compare, API-key hashing | `packages/auth/src/index.ts` |
| Plugin manifest type, status enums | `packages/types/src/index.ts` |
| Dev / prod compose topology | `docker/docker-compose.dev.yml`, `docker/docker-compose.prod.yml` |
| SSM → `.env` render script | `scripts/render-env.sh` |
| Env var names + SSM flow docs | `.env.example` |
| Meta-tool migration decision doc | `docs/architecture/2026-04-22-meta-tool-migration.md` |

## Commands

- Tests: `pnpm vitest run` (in `apps/gateway`) · Typecheck: `pnpm exec tsc --noEmit` · Build: `pnpm build`
- Dev: `pnpm dev:infra` (postgres + db-init) then `pnpm dev:gateway`; or in `apps/gateway`: `pnpm dev`
- Migrations: `pnpm --filter @datatorag-mcp/db db:generate` / `db:migrate` (`db:push` is dev-only)
- Deploys and DB queries: use the `deploy` and `db-query` skills — infra specifics live there and in private memory.
