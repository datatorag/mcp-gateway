# Brevo connector: implementation plan (SCRUM-468)

> **For agentic workers:** implement task by task; steps use checkbox (`- [ ]`) syntax.

**Goal:** our own Brevo organisation is connected to the gateway by OAuth, and twenty Brevo tools
are served to an admin; `destructiveHint` is served to MCP clients.

**Architecture:** a `brevo-mcp` plugin in the `notion-mcp` shape, a Notion-style connect pair in
`auth.ts` against Brevo's partner OAuth with a refresh under a row lock, an `audience` gate on the
service entry, and a separate registry column for `destructiveHint`.

**Tech stack:** TypeScript plugins built by `tsc`, Express routes, drizzle, vitest with stubbed
fetch, real Postgres for the refresh lock.

**Spec:** `docs/architecture/2026-11-01-scrum-468-brevo-connector-design.md`. The plan
assumes the recommended answer to each ruling question.

## Global constraints

- Every Brevo call sends `Authorization: Bearer <token>` to `https://api.brevo.com/v3`; nothing
  logs a body, a parameter or a token.
- One tool call is one Brevo call, except `campaign_send` (two).
- Writes are never retried; a read retries a 429 only inside an 8-second budget.
- No em-dashes in any string; tested where the copy is in code.
- Public repo: "per SCRUM-468" in comments, no HQ ids, counts or names.

## Review focus

1. A link-only connect whose Brevo email is not the user's sign-in email stores nothing (Task 5).
2. A refresh racing another refresh leaves one live pair (Task 5, real Postgres).
3. A 429 with a reset an hour away answers at once, never sleeps (Task 2).
4. `campaign_send` with a send limit below the recipient count sends nothing (Task 4).
5. A non-admin never sees Brevo offered anywhere, and the start route refuses them (Task 6).

---

### Task 0 (its own pull request): serve `destructiveHint`

**Files:** `packages/db/src/schema/tools.ts` and a generated migration; `plugin-manager.ts`
(`discoverTools`); `scripts/registry-diff.mjs` and its tests; `mcp-server.ts` (ListTools);
`codebase-map` and `ops-debugging` skills.

- [ ] Failing tests: discovery stores `destructiveHint`; the diff tool's insert, update and guard
  carry `destructive_hint`; ListTools serves it only for a non-read-only row with a value, and
  never for a null.
- [ ] Column via `db:generate`, the capture, the diff field, the serve.
- [ ] Gate, leak scan, security review, PR. The per-plugin registry pairs that fill existing rows
  are generated after it merges, for HQ to run.

### Task 1: plugin scaffold

**Files:** `plugins/brevo-mcp/{package.json,tsconfig.json,datatorag.json,README.md,CLAUDE.md,LICENSE}`,
`src/{index.ts,create-server.ts,error-meta.ts,rate-limit-retry.ts}`, `src/tools/{annotations.ts,response.ts,index.ts}`.

- [ ] Copy the notion-mcp skeleton; READ, WRITE, MUTATE annotations; the 900 KB cut and
  `truncate`; tests for the annotations and the server's dispatch.

### Task 2: the client

**Files:** `src/brevo-client.ts` and its test.

**Interfaces (produces):** `class BrevoClient { request(method, path, opts): Promise<unknown>; forTool(readOnly): BrevoClient; lastRateLimit(): { remaining: number; resetSeconds: number } | null }`; `BrevoApiError` with `status`, `code`.

- [ ] Failing tests: Bearer header and base URL; 401 reconnect wording; 402 wording; 429 with a
  near reset retried for a read and not for a write; 429 with a far reset answered at once,
  transient; 5xx on a write says "may have been applied"; no body or parameter in a log line.
- [ ] Implement; commit.

### Task 3: the eleven reads

**Files:** `src/tools/brevo-read.ts` and tests; fixtures under `src/fixtures/`.

`account_get`, `contacts_search`, `contact_get`, `lists_get`, `campaigns_list`, `campaign_get`,
`campaign_export_recipients`, `process_get`, `email_stats`, `templates_get`, `email_log`.

- [ ] Failing tests per tool: the request shape; `campaigns_list` always sends
  `excludeHtmlContent=true`; `campaign_get` and `templates_get` return HTML only with
  `include_html`, cut at `max_html_chars`; `templates_get` drops HTML from a list; page caps of
  100 on `contacts_search` and `email_log`; unknown arguments refused.
- [ ] Implement; commit.

### Task 4: the nine writes

**Files:** `src/tools/brevo-write.ts` and tests.

`contact_create`, `contact_update`, `list_members_update`, `campaign_create`, `campaign_update`,
`campaign_send_test`, `campaign_send`, `campaign_set_status`, `email_send`.

- [ ] Failing tests: request shapes; `campaign_update` refuses `scheduled_at`; `campaign_send`
  reads the send limit, answers with the recipient count and the limit, and sends nothing when the
  limit is short; `campaign_send` and `email_send` carry MUTATE and say they cannot be recalled;
  the descriptions carry no em-dash.
- [ ] Implement; commit.

### Task 5: the gateway connect, refresh and revoke

**Files:** `packages/config` (two keys), `auth.ts` (the pair), `service-token.ts`
(`PLUGIN_SERVICE_MAP`, `REFRESH_FN`, `REVOKE_FN`), `connected-accounts.ts` (nothing new
expected), `connect-duplicate.ts`, `connect-link-page.ts`, `lib/analytics.ts` (`PROVIDERS`),
`scope-grant.ts` (`CONNECTORS_WITHOUT_SCOPES`), `.env.example`, `docker/docker-compose.prod.yml`
environment list; tests beside each, `service-token.brevo-refresh.test.ts` on real Postgres.

- [ ] Failing tests: start redirects with the scopes and `state`; callback outcomes (session,
  link-only with and without the email match, duplicate, refused exchange); the ordering test
  includes the route; the refresh race test red without the lock; revoke never blocks a
  disconnect.
- [ ] Implement; commit.

### Task 6: the audience gate

**Files:** `service-registry.ts` (`audience`), a new `serviceOfferedTo` beside
`service-launch.ts`, every surface that offers a connect (dashboard cards and service page, the
agent's `request_connection` and empty state, `connect-tool.ts`, `server-instructions.ts`, the
start route); tests.

- [ ] Failing tests: a non-admin sees no Brevo on any surface and is refused at the start route;
  an admin sees it; the other three providers unchanged.
- [ ] Implement; commit.

### Task 7: packaging, presentation and docs

**Files:** `apps/gateway/Dockerfile`, `scripts/gate.sh`, `SERVICE_PRESENTATION`,
`KNOWN_READ_TOOLS`, the classification snapshot, logos and icons, the copy that names providers,
`content/docs/brevo.md`, `lib/docs-connectors.ts`, the registry pair from
`pnpm registry:diff brevo-mcp --new-plugin`.

- [ ] The gate's self-test knows the new path; the build's account check passes; the snapshot
  and `KNOWN_READ_TOOLS` agree with the declared annotations.
- [ ] Commit.

### Task 8: runner, gate and PR

**Files:** `tests/cases/br1..br5-*.ts`, `tests/scenarios.ts` (the `brevo` scenario and two
uncovered-on-purpose entries), `tests/send-guard.ts`, `tests/types.ts` (fixture keys),
`lib/status/public-titles.ts`.

- [ ] Cases as the spec lists; the send guard refuses any Brevo send but a test send to the reader
  mailbox.
- [ ] `content-marketer` for the docs page; `scripts/gate.sh origin/main`, `pnpm build`, the leak
  scan, merge-base, the security review; PR. No merge, no deploy.
- [ ] Before the deploy: the private app registered, the two configuration keys in place, the
  refresh token's thirty days measured as absolute or renewed, and the runner's fixtures on the
  test account.
