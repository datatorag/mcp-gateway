# Slack Connector (own workspace) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins of the gateway can connect their Slack account in the company workspace and use ten Slack tools through the gateway. No other user is offered Slack.

**Architecture:**
- An internal Slack app (not distributed) issues user tokens through OAuth v2 with rotation.
- The gateway gains a Slack connect pair, refresh and revoke, plus an `audience: "admin"` field on connectable services that hides Slack from non-admins.
- A new `plugins/slack-mcp`, shaped like `notion-mcp`, wraps the Web API: six reads and four writes, with a required expected-target guard on the writes.

**Tech Stack:** TypeScript, Express + Next.js gateway, `@modelcontextprotocol/sdk`, zod 4, vitest, drizzle, pnpm.

**Spec:** `docs/architecture/2026-11-01-scrum-454-slack-connector-design.md`

## Global Constraints

- **Public repo.** Rules go in commits, never evidence: no customer names, analytics figures, internal ids or workspace ids in code, tests or messages. Fixture ids come from the environment.
- **Ids:**
  - Service id `slack`, plugin slug `slack-mcp`.
  - Tool names `slack_channels_list`, `slack_messages_search`, `slack_channel_history`, `slack_thread_read`, `slack_users_lookup`, `slack_files_list`, `slack_reactions_add`, `slack_message_update`, `slack_message_post`, `slack_dm_send`.
  - Config keys `SLACK_CONNECTOR_CLIENT_ID`, `SLACK_CONNECTOR_CLIENT_SECRET`, `SLACK_CONNECTOR_TEAM_ID`. Never reuse or rename `SLACK_BOT_TOKEN`.
- **User scopes, exactly:** `channels:read,groups:read,im:read,mpim:read,channels:history,groups:history,im:history,mpim:history,search:read,chat:write,reactions:write,im:write,users:read,users:read.email,files:read`. No bot scopes.
- **Caps:**
  - Per-message text 2,000 characters with the shared truncation marker.
  - Response 900 KB.
  - `limit`/`count` defaults and maxima as in spec section 3.
- **Retries:** read-only tools only, at most 3 attempts, `Retry-After` in whole seconds. A write is never retried.
- **Commands:**
  - Gateway tests: `cd apps/gateway && pnpm vitest run <file>`, with `NODE_TLS_REJECT_UNAUTHORIZED` unset.
  - Plugin tests: `cd plugins/slack-mcp && pnpm test`.
  - Typecheck: `pnpm exec tsc --noEmit` in each package.
  - Gate: `scripts/gate.sh`.
- **Ship ritual.** No push without the security-reviewer PASS on the outgoing diff. Nothing deploys from this session. Registry SQL is generated here and run by HQ.
- **Skill freshness.** A commit that changes a pattern documented in `.claude/skills/` updates that skill in the same commit.
- No em-dashes in copy or docs.

## Review Focus

1. **A user who is not an admin** must not see Slack on any surface or be able to start its connect route. Covered by: Task 1 test `non-admin is not offered slack on any surface`, Task 2 test `connect route 404s for a non-admin`.
2. **Two concurrent calls with an expired token** must not spend the same single-use refresh token twice. Covered by: Task 3 test `concurrent refreshes take the row lock and refresh once`.
3. **A channel name that matches two channels** (for example a public and an archived one) must be refused, not guessed. Covered by: Task 5 test `ambiguous channel name is refused with both ids`.
4. **A write whose expected target differs only by `#` or letter case** passes, while a different channel is refused with nothing sent. Covered by: Task 6 tests `expected name matches ignoring # and case` and `mismatched channel sends nothing`.
5. **A post that times out** is not retried and says it may have landed. Covered by: Task 6 test `post timeout is not retried and says it may have posted`.

---

### Task 0: Registration and observation (stage 0, no product code)

The founder does the registration, through HQ. This session does the observation and writes up the results.

- [ ] **Step 1:** The founder creates an internal app in the company workspace with:
  - the user scopes above;
  - token rotation on;
  - redirect URIs `https://<prod host>/auth/slack/connect/callback` and `http://localhost:8285/auth/slack/connect/callback`;
  - public distribution off.
- [ ] **Step 2:** The three keys reach the local `.env` and the parameter store, by a route the founder chooses. They are never printed.
- [ ] **Step 3:** Using a scratch `.mts` harness under `apps/gateway` (not committed), observe and record in the PR description, as rules not values:
  - whether a user-scope-only grant returns `expires_in` and `refresh_token`;
  - whether `users.info` returns the email;
  - whether revoking the access token also kills the refresh token;
  - the exact `error` string for a reused refresh token.
- [ ] **Step 4:** If any observation contradicts spec section 2, update the spec before Task 3.

### Task 1: Admin audience on connectable services

**Files:**
- Modify: `apps/gateway/src/app/dashboard/connections/service-registry.ts`: add `audience?: "admin"` to `ConnectableService`, and export `PUBLIC_SERVICE_IDS`.
- Modify: `apps/gateway/src/gateway/service-launch.ts`: change to `launchedServiceIds(db, userId)` and `isServiceLaunched(db, serviceId, userId)`.
- Modify the callers to pass the user id:
  - `apps/gateway/src/gateway/connect-tool.ts`
  - `apps/gateway/src/gateway/connections-view.ts`
  - `apps/gateway/src/app/dashboard/connections/[service]/page.tsx`
  - `apps/gateway/src/mastra/mcp/client.ts`
  - `apps/gateway/src/gateway/auth.ts` (Notion route)
- Modify: `apps/gateway/src/gateway/mcp-server.ts:637`: build the connect enum from services with no `audience`.
- Test: `apps/gateway/src/gateway/service-launch.test.ts` (extend or create).
- Modify skill: `.claude/skills/codebase-map` (connectable-service gating paragraph).

**Interfaces:**
- Produces:
  - `launchedServiceIds(db: Database, userId: string): Promise<Set<string>>`
  - `isServiceLaunched(db: Database, serviceId: string, userId: string): Promise<boolean>`
  - `ConnectableService.audience?: "admin"`
  - `PUBLIC_SERVICE_IDS: readonly string[]` (the ids with no audience)
- Uses `isAdmin(db, userId)` from `src/gateway/admin.ts`.

- [ ] **Step 1: Write the failing tests.** Use a test-local registry entry `{id: "x", audience: "admin", launchPluginSlug: "x-mcp"}` with its row active:
  - `admin-audience service is launched for an admin`: the set contains `x`.
  - `non-admin is not offered slack on any surface`: the set omits `x`, and `isServiceLaunched(db, "x", nonAdmin)` is false.
  - `role read failure reads as not admin`: `isAdmin` throws, and the set omits `x` but keeps the ungated ids.
  - `connect enum never names an audience-gated service`: the tool definition's enum equals `PUBLIC_SERVICE_IDS`.
- [ ] **Step 2:** Run `pnpm vitest run src/gateway/service-launch.test.ts`. Expected: FAIL (arity and `audience` unknown).
- [ ] **Step 3: Implement.**
  - Read the role once per call, only if some audience-gated service is in the launched set.
  - Thread `userId` through each caller.
- [ ] **Step 4:** Run the test file plus `pnpm exec tsc --noEmit`. Expected: PASS, no type errors.
- [ ] **Step 5: Commit.** `feat(gateway): admin audience on connectable services`

### Task 2: Slack connect pair and config

**Files:**
- Create: `apps/gateway/src/gateway/slack-oauth.ts`. It holds:
  - `SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize"`
  - `SLACK_TOKEN_URL = "https://slack.com/api/oauth.v2.access"`
  - `SLACK_REVOKE_URL = "https://slack.com/api/auth.revoke"`
  - `SLACK_USER_SCOPES` (the constraint string)
  - `exchangeSlackCode`
  - `slackUserEmail`
- Modify: `packages/config/src/index.ts`: add the three keys, optional strings. Then rebuild `packages/config`, whose dist is what the gateway consumes.
- Modify: `.env.example`, `docker-compose.prod.yml` environment list, README env table.
- Modify: `apps/gateway/src/gateway/auth.ts`: `/auth/slack/connect` and its callback, `SLACK_CONNECT_NONCE_COOKIE`.
- Modify: `apps/gateway/server.ts`: router config.
- Modify the provider tables:
  - `src/lib/analytics.ts` `PROVIDERS.SLACK = "slack"`
  - `src/gateway/connect-duplicate.ts` (`CONNECT_START`, `DuplicateProvider`, `ACCOUNT_NOUN`: "workspace")
  - `src/gateway/connect-link-page.ts`
  - `src/components/attribution-links.tsx` `ATTRIBUTED_PATHS`
  - `service-registry.ts`: the Slack entry `{id: "slack", name: "Slack", connectUrl: "/auth/slack/connect", launchPluginSlug: "slack-mcp", audience: "admin"}`
- Test: `apps/gateway/src/gateway/slack-accounts.test.ts` (shape after `notion-accounts.test.ts`), plus a row in `auth-callback-ordering.test.ts`.

**Interfaces:**
- Produces:
  - `exchangeSlackCode(code: string, redirectUri: string): Promise<SlackGrant>`, where `SlackGrant = {teamId: string, teamName: string, userId: string, accessToken: string, refreshToken: string | null, expiresIn: number | null, scopes: string[], enterprise: boolean}`
  - `slackUserEmail(token: string, userId: string): Promise<string | null>`
- Uses (from Task 1): `isServiceLaunched(db, PROVIDERS.SLACK, userId)`.

- [ ] **Step 1: Write the failing tests.** Fake fetch, no network:
  - `connect route 404s for a non-admin`.
  - `connect redirects with user_scope and no scope param`: assert the URL's `user_scope` equals `SLACK_USER_SCOPES` and that `scope` is absent.
  - `callback refuses a team that is not SLACK_CONNECTOR_TEAM_ID and stores nothing`.
  - `callback refuses an enterprise install`.
  - `callback refuses a grant with no email and stores nothing`.
  - `callback stores sealed tokens with external_account_id = team id and label = team name`.
  - `missing config answers not configured and offers nothing`.
  - The ordering row: `/auth/slack/connect/callback` with `res.clearCookie(SLACK_CONNECT_NONCE_COOKIE`.
- [ ] **Step 2:** Run both test files. Expected: FAIL.
- [ ] **Step 3: Implement**, copying the Notion pair's order of checks:
  - nonce, then `ok`, then enterprise, then team id, then email, then the duplicate and unconfirmed refusals, then `upsertServiceAccount`;
  - `exchangeSlackCode` posts form-encoded `client_id`, `client_secret`, `code`, `redirect_uri`.
- [ ] **Step 4:** Run the tests plus tsc. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(gateway): Slack connect for the company workspace`

### Task 3: Refresh, revoke, service map, redaction

**Files:**
- Modify: `apps/gateway/src/gateway/service-token.ts`:
  - `PLUGIN_SERVICE_MAP["slack-mcp"] = "slack"`
  - `refreshSlackToken` in `REFRESH_FN`
  - `revokeSlackGrant` in `REVOKE_FN`
- Modify: `apps/gateway/src/gateway/scope-grant.ts`: Slack answers complete.
- Modify: `apps/gateway/src/gateway/usage/redact.ts`: the Slack envelope case.
- Test: `apps/gateway/src/gateway/service-token.slack-refresh.test.ts` (after the Notion one); `usage/redact.test.ts`.

**Interfaces:**
- Produces: `refreshSlackToken(db, conn: ConnectionRef, rt: string): Promise<RefreshOutcome>`, and `revokeSlackGrant(tokens: RevokeTokens): Promise<boolean>`.

- [ ] **Step 1: Write the failing tests:**
  - `concurrent refreshes take the row lock and refresh once`: two parallel resolves on an expired row make exactly one token call, and both get the new token.
  - `refresh persists the new refresh token and token_expires_at from expires_in`.
  - `invalid_refresh_token is permanent, a 500 is transient`.
  - `revoke posts the access token and never throws`.
  - `redact keeps only error from a Slack ok:false body`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement**, reusing the Notion refresh's lock helper rather than copying it. If it is private, export it.
- [ ] **Step 4:** Run the tests plus tsc. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(gateway): Slack token refresh and revoke`

### Task 4: Plugin scaffold and Slack client

**Files:**
- Create `plugins/slack-mcp/` by copying `plugins/notion-mcp/` and keeping:
  - `package.json` (name `slack-mcp`), `tsconfig*.json`, `datatorag.json` (oauth block naming the three keys), `CLAUDE.md`, `README.md`, `LICENSE`;
  - `src/index.ts`, `src/create-server.ts`, `src/rate-limit-retry.ts`, `src/error-meta.ts`;
  - `src/tools/annotations.ts`, `src/tools/response.ts`, `src/tools/index.ts`;
  - `src/fixtures/fake-fetch.ts`.
- Create: `plugins/slack-mcp/src/slack-client.ts`.
- Test: `plugins/slack-mcp/src/slack-client.test.ts`; copied `annotations.test.ts`, `described-not-instructed.test.ts`, `rate-limit-retry.test.ts`.

**Interfaces:**
- Produces:
  - `slackCall<T>(token: string, method: string, params: Record<string, unknown>, opts: {readOnly: boolean}): Promise<T>`. It throws `SlackApiError {error: string, method: string}` on `ok: false`, and `SlackUnreachableError` on network or timeout.
  - `paginate(cursor?: string)`.
  - `resolveChannel(token, ref: string): Promise<{id: string, name: string}>`, which accepts an id or `#name`.
  - `resolveMentions(token, text: string, cache: Map<string, string>): Promise<string>`.
  - `trimText(text: string): string` (2,000 chars, shared marker).
- Reads use GET with query params; writes use POST JSON with `Authorization: Bearer`. 60 s timeout.

- [ ] **Step 1: Write the failing tests:**
  - `ok:false maps to SlackApiError with the error code`.
  - `missing_scope is rewritten to reconnect Slack`.
  - `ratelimited on a read retries with Retry-After, at most 3 attempts`.
  - `ratelimited on a write is not retried`.
  - `no token refuses before any request`.
  - `ambiguous channel name is refused with both ids`.
  - `mentions resolve to @name and #name, each user looked up once per call`.
  - `trimText marks text over 2,000 chars`.
- [ ] **Step 2:** Run `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run `pnpm test` plus tsc. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(slack-mcp): plugin scaffold and Web API client`

### Task 5: The six reads

**Files:**
- Create: `plugins/slack-mcp/src/tools/slack-read.ts`.
- Test: `plugins/slack-mcp/src/tools/slack-read.test.ts`, with JSON fixtures per method under `src/fixtures/`, shaped from Slack's documented responses.

**Interfaces:**
- Consumes the Task 4 client.
- Produces registered tools with the names, arguments, defaults and maxima of spec section 3, each with `READ` annotations and `toolReadOnly: true`.

- [ ] **Step 1: Write the failing tests**, one describe per tool:
  - `slack_channels_list caps limit at 200 and passes cursor`.
  - `slack_messages_search caps count at 50 and returns permalink`.
  - `slack_channel_history accepts #name and returns resolved user names`.
  - `slack_thread_read returns the parent first`.
  - `slack_users_lookup requires exactly one of email or user_id`.
  - `slack_files_list never returns file bytes`.
  - `ambiguous channel name is refused with both ids` (through `slack_channel_history`).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement.** Descriptions are one or two sentences that say what the tool does, takes and returns, with no instructing words.
- [ ] **Step 4:** Run `pnpm test` plus tsc. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(slack-mcp): six read tools`

### Task 6: The four writes and the guard

**Files:**
- Create: `plugins/slack-mcp/src/tools/slack-write.ts`, `src/tools/expected-target.ts`.
- Modify: `apps/gateway/src/gateway/playground/tools.ts`: add `"post"` to `WRITE_VERBS`; add the six reads to `KNOWN_READ_TOOLS`.
- Modify: `apps/gateway/src/gateway/tool-classification.test.ts`: snapshot rows for all ten.
- Test: `plugins/slack-mcp/src/tools/slack-write.test.ts`, `expected-target.test.ts`.

**Interfaces:**
- Produces: `checkExpectedChannel(resolved: {name: string}, expected: string): void`, and `checkExpectedUser(email: string | null, expected: string): void`. Both throw a refusal naming the resolved target.

- [ ] **Step 1: Write the failing tests:**
  - `expected name matches ignoring # and case`.
  - `mismatched channel sends nothing`: assert no `chat.postMessage` call was made.
  - `dm_send refuses when the user's email differs and opens no conversation`.
  - `dm_send accepts an email for user and resolves it through users.lookupByEmail`.
  - `message_update refuses on channel mismatch`.
  - `post timeout is not retried and says it may have posted`.
  - `post, dm and update carry destructiveHint true; reactions_add does not`.
  - In the gateway: `slack_message_post classifies as write by the post verb`, and the snapshot.
- [ ] **Step 2:** Run both suites. Expected: FAIL.
- [ ] **Step 3: Implement.** `expected_channel_name` and `expected_user_email` are required in the schemas.
- [ ] **Step 4:** Run both suites plus tsc. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(slack-mcp): four write tools behind the expected-target guard`

### Task 7: Packaging, presentation and catalogue

**Files:**
- Modify: `apps/gateway/Dockerfile`: COPY lines beside notion-mcp's (40, 72, 98, 101), plus a `plugin-slack-mcp` group and user on the next free uid. If the Brevo branch has merged, take the uid after its account.
- Modify: `scripts/gate.sh`: a `slack-mcp` path row, surface and self-test lines.
- Modify the presentation and catalogue:
  - `src/app/dashboard/connections/services.tsx` (presentation row);
  - `service-icon.tsx`, `server-logos.tsx`, `integration-catalog.tsx` (SVG with its provenance line);
  - `lib/skill-links.ts` (`SERVICE_ID_BY_CONNECTOR.Slack`, `^slack_` in `connectorsFor`);
  - `gateway/skills-catalogue.ts`;
  - `agent-parts.tsx`, `api/agent/suggestions/route.ts`, `agent/suggestion-generator.ts`;
  - `lib/status/surfaces.ts`;
  - `connect-tool.ts:22` description (stays without Slack, since the enum is public).
- Modify skills: `.claude/skills/gws-mcp-dev` (fourth plugin) and `gateway-dev` (audience recipe).
- Test: the existing presentation-completeness test (it throws at load if a registry id has no row), and `skill-links.test.ts` gains `slack_ tools map to Slack`.

- [ ] **Step 1: Write the failing test** `slack_ tools map to Slack`, and run the presentation test. Expected: both FAIL.
- [ ] **Step 2: Implement.**
- [ ] **Step 3:** Run `scripts/gate.sh` and `pnpm build` in `apps/gateway`. Expected: gate green, including the new slack-mcp row's self-test; build succeeds.
- [ ] **Step 4: Commit.** `feat: package slack-mcp and present Slack to admins`

### Task 8: Test runner cases and send guard

**Files:**
- Modify the runner's role tables: `apps/gateway/src/gateway/tests/` (`ACCOUNT_ROLES`, `PLUGIN_ROLES["slack-mcp"]`, `FIXTURE_KEYS.slackChannel`).
- Modify: `.env.example` `TEST_RUNNER_FIXTURES` shape.
- Modify: `apps/gateway/src/gateway/tests/send-guard.ts`: the Slack rule.
- Create: `apps/gateway/src/gateway/tests/cases/sl*.ts`, one case per tool.
- Create: `send-guard.slack.test.ts`.

- [ ] **Step 1: Write the failing tests:**
  - `send guard refuses a Slack write outside the fixture channel against the real handler`.
  - `send guard allows a DM only to the test user's own DM`.
  - `every slack-mcp tool has a case`, through the existing coverage check.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement.** Write cases restore what they change: post, then update, then react on a labelled fixture message.
- [ ] **Step 4:** Run the runner suites plus tsc. Expected: PASS.
- [ ] **Step 5: Commit.** `test(runner): Slack cases and send guard`

### Task 9: Registry pair and hand-off (stage 3)

- [ ] **Step 1:** Ask HQ for the running production sha.
- [ ] **Step 2:** Run `pnpm registry:diff slack-mcp --new-plugin --from <running sha> --to <branch head sha>`. Commit the generated `registry/2026-MM-DD-scrum-454-slack-mcp{,.rollback}.sql` unedited.
- [ ] **Step 3:** Run `node scripts/registry-file-check.mjs`. Expected: PASS.
- [ ] **Step 4:** Run the security-reviewer on `origin/main...HEAD`. Push only on PASS, under the org account.
- [ ] **Step 5:** Report to HQ: the PR, the branch sha, and the registry pair paths. HQ runs the rows, deploys on the founder's go, and the founder connects.
