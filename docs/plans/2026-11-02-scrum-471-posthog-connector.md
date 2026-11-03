# PostHog connector: implementation plan (SCRUM-471)

> **For agentic workers:** implement task by task; steps use checkbox (`- [ ]`) syntax.

**Goal:** an admin connects one PostHog project to the gateway by OAuth with a Client ID Metadata
Document, and ten read-only PostHog tools are served to them and to nobody else.

**Architecture:** a `posthog-mcp` plugin in the `notion-mcp` shape; a static metadata-document
route and a PKCE connect pair in `auth.ts` against one regional host; the project and host handed
to the plugin in two context headers beside the token; the existing `audience` gate.

**Tech stack:** TypeScript plugins built by `tsc`, Express routes, drizzle, vitest with stubbed
fetch, real Postgres for the refresh lock.

**Spec:** `docs/architecture/2026-11-02-scrum-471-posthog-connector-design.md`, with HQ's
rulings: the regional host from configuration, a production-only redirect, the `/query` line
accepted for own use, no app verification.

## Global constraints

- Every PostHog call goes to `POSTHOG_CONNECTOR_BASE_URL` (`https://us.posthog.com` by default; only the
  US and EU hosts are accepted) under `/api/projects/{project}/`, with `Authorization: Bearer`.
- No client secret anywhere; PKCE S256 on every connect.
- Nothing logs a token, a query, a body or a parameter value; paths are logged as templates.
- Every tool is `readOnlyHint: true`; there are no writes.
- A read retries a 429 once, only inside an 8-second budget; at most two calls at once per session.
- No em-dashes in any string; tested where the copy is in code.
- Public repo: "per SCRUM-471" in comments; no HQ ids, project ids, counts, names or emails.

## Review focus

1. A token response granting zero or several projects stores nothing (Task 3).
2. A plugin handed a host that is not a PostHog regional host sends the token nowhere (Task 5).
3. A link-only connect whose userinfo has no `email_verified` stores nothing (Task 3).
4. A value in `posthog_events_list` reaches PostHog as a query parameter, never inside the HogQL
   text (Task 6).
5. A non-admin sees PostHog on no surface and is refused at start and at callback (Task 3).

---

### Task 1: the metadata document and configuration

**Files:** `packages/config/src/index.ts` (`POSTHOG_CONNECTOR_BASE_URL`, refused outside the two hosts),
`.env.example`, `docker/docker-compose.prod.yml` environment list; create
`apps/gateway/src/gateway/posthog-oauth.ts` (constants, `posthogClientMetadata`, `pkcePair`) and
its test; the route in `server.ts` before the Next catch-all.

**Interfaces (produces):** `POSTHOG_SCOPES: string` (space-separated);
`posthogEndpoints(host): { authorize, token, revoke, userinfo, project(id) }`;
`posthogClientMetadata(baseUrl): object`; `pkcePair(): { verifier: string; challenge: string }`.

- [ ] Failing tests: the document's `client_id` equals `<base>/auth/posthog/client.json`; its
  serialised size is under 5,120 bytes; `com.posthog.scopes` joined equals `POSTHOG_SCOPES`;
  `client_name` matches none of PostHog's banned words; the route answers 200 JSON with
  `Cache-Control: public, max-age=3600` and no session; `pkcePair` gives a 43-character verifier
  and `challenge === base64url(sha256(verifier))`; config refuses `https://evil.example`.
- [ ] Implement; commit.

### Task 2: context headers to the plugin

**Files:** `service-token.ts` (`PLUGIN_CONTEXT` and `pluginContextHeaders`, and
`resolveServiceToken` returns `externalAccountId`), `user-tools.ts`
(`callPluginToolOnce` takes `contextHeaders?: Record<string, string>`), `mcp-server.ts` (passes
them); tests.

- [ ] Failing tests: a service with no context sends only `X-User-Token`, unchanged; the
  PostHog entry sends `X-PostHog-Host` and `X-PostHog-Project` from config and the account's
  external id; an account with no external id sends no project header.
- [ ] Implement; commit.

### Task 3: the connect, refresh, revoke and audience

**Files:** `auth.ts` (the pair), `service-token.ts` (`PLUGIN_SERVICE_MAP`, `refreshPostHogToken`,
`REFRESH_FN`, `REVOKE_FN`), `service-registry.ts` (`posthog`, `audience: "admin"`,
`launchPluginSlug: "posthog-mcp"`), `connect-duplicate.ts`, `connect-link-page.ts`,
`lib/analytics.ts` (`PROVIDERS`), `scope-grant.ts` (`CONNECTORS_WITHOUT_SCOPES`);
`auth-connect-posthog.test.ts` (real router over HTTP, as Brevo's),
`service-token.posthog-refresh.test.ts` (real Postgres), the ordering test.

- [ ] Failing tests:
  - start: redirect to `<host>/oauth/authorize/` with `client_id` the document URL, the scopes,
    `state` equal to the nonce cookie, `code_challenge` the S256 of the PKCE cookie,
    `required_access_level=project`; a non-admin refused with no cookie set;
  - callback: exchange body carries `code_verifier` and `client_id` and no `client_secret`;
    `scoped_teams: [N]` stores the account with `externalAccountId` `"N"`, the project's name as
    label and the response's expiry; `[]` and `[1, 2]` store nothing and say to choose one
    project; a `posthog_base_url` other than the configured host stores nothing; link-only with
    `email_verified: true` completes and mints the link user's session; link-only with the claim
    false or absent stores nothing; refused exchange, missing email and bad state store nothing;
    a non-admin refused at the callback;
  - refresh: one call for two concurrent refreshes, no secret in the body; a refused refresh is
    permanent;
  - revoke posts the refresh token and `client_id` to `/oauth/revoke/` and never blocks a
    disconnect;
  - a non-admin sees PostHog on no connect surface.
- [ ] Implement; commit.

### Task 4: plugin scaffold

**Files:** `plugins/posthog-mcp/{package.json,tsconfig.json,datatorag.json,README.md,CLAUDE.md,LICENSE}`,
`src/{index.ts,create-server.ts,error-meta.ts,rate-limit-retry.ts}`,
`src/tools/{annotations.ts,response.ts,index.ts}`, `.gitignore`.

- [ ] Copy the notion-mcp skeleton; `index.ts` reads `X-User-Token`, `X-PostHog-Host` and
  `X-PostHog-Project` once per session and refuses the session if the host is not one of the two
  or the project is not digits; `response.ts` caps text at 50,000 characters with `truncated`.
  Tests for the refusals, the cap and the dispatch.
- [ ] Commit.

### Task 5: the client

**Files:** `src/posthog-client.ts` and its test.

**Interfaces (produces):** `class PostHogClient { constructor(host, project, token); get(template, params?, query?): Promise<unknown>; query(kind: string, body: object, toolName: string): Promise<unknown> }`; `PostHogApiError` with `status`, `retryAfter?`.

- [ ] Failing tests: Bearer header, the host and `/api/projects/{project}/` prefix; `query` posts
  `{ query, name: "datatorag:<tool>", refresh: "blocking" }`; 401 says reconnect; 403 says not
  granted; 429 with `Retry-After: 3` retried once, with `Retry-After: 60` answered at once; a
  third concurrent call waits; no value or body in a log line.
- [ ] Implement; commit.

### Task 6: the ten tools

**Files:** `src/tools/posthog-read.ts` and tests; fixtures under `src/fixtures/`.

- [ ] Failing tests per tool, the shapes and caps in the spec's table:
  - `posthog_project_get` never returns `api_token` or test-account filter values;
  - `posthog_trends_query`, `posthog_events_list`, `posthog_web_overview` refuse a missing
    `date_to`; trends caps breakdown values at 25;
  - `posthog_hogql_query` appends `LIMIT 100` when absent, clamps `LIMIT 5000` to 1,000, refuses
    anything but one `SELECT`;
  - `posthog_events_list` sends filter values in `placeholders`, and a value holding a quote
    appears nowhere in the query text;
  - `posthog_error_issues_list` sends `ErrorTrackingQuery` with `dateRange`, `orderBy`,
    `volumeResolution`;
  - every tool is `readOnlyHint: true`, `additionalProperties: false`, no em-dash.
- [ ] Implement; commit.

### Task 7: packaging, runner, gate and PR

**Files:** `apps/gateway/Dockerfile` (files, `plugin-posthog-mcp` uid and gid 906),
`scripts/gate.sh` and its self-test, `SERVICE_PRESENTATION`, `KNOWN_READ_TOOLS`, the
classification snapshot, the logo; `tests/cases/ph1..ph5-*.ts`, `tests/scenarios.ts` (`posthog`),
`tests/types.ts` and `.env.example` (fixture keys for the project and a saved insight),
`codebase-map` and `services-integrations` skills. No public titles (admin-only, as Slack). The
registry pair from `pnpm registry:diff posthog-mcp --new-plugin` follows the merge, in its own
pull request: it is generated from CI's build record on `main`.

- [ ] The gate's self-test knows the path; the build's account check passes; snapshot and
  `KNOWN_READ_TOOLS` agree with the declared annotations; runner cases as the spec lists.
- [ ] `scripts/gate.sh origin/main`, `pnpm build`, the leak scan, merge-base, the security
  review; PR. No merge, no deploy, no registry write.
- [ ] Before the deploy (HQ's): `POSTHOG_CONNECTOR_BASE_URL` in the host render if not the default, the
  runner fixtures on HQ's project. After it: the first live connect records the token lifetime,
  rotation and `email_verified` against what the spec took from source.
