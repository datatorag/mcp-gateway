# A PostHog connector (SCRUM-471)

Status: spec, written from the code at `a4bae684`. Nothing here is built until a go.

PostHog becomes a provider beside Google Workspace, Atlassian, Notion, Brevo and Slack: a
`posthog-mcp` plugin in the `notion-mcp` shape, ten read-only tools over PostHog's REST and
query APIs, connected by OAuth with a Client ID Metadata Document. It is for our own use first,
offered to admins only through the `audience` field (SCRUM-468), and hidden from every public
surface.

## Rulings this spec builds on

- **The regional host, not `oauth.posthog.com`.** PostHog's region-agnostic host is a proxy that
  remembers the region a user picked under the client id alone. A metadata-document client has
  one client id for every user, so two users in different regions connecting within the same
  hour would overwrite each other. The gateway talks to one regional host, `https://us.posthog.com`,
  taken from a per-service configuration value so another region is one line later.
- **A production-only redirect** in the metadata document. No `localhost` entry: one would let
  anyone run a flow that shows our name on PostHog's consent screen and lands on their own
  machine. Local work runs against a fake PostHog; the real flow is proved on production through
  the runner.
- **Own use accepts PostHog's `/query` connector line.** PostHog's query documentation says
  third-party connectors must use its exports, not `/query`. That text is about bulk export; an
  interactive connector asking short, bounded, named questions is not that. Six of the ten tools
  use `/query`. See the ask section.
- **No PostHog app verification for now.** It only removes an "unverified application" notice.
- **Ten tools, all read-only.** No writes in the first release.

## What the code does today, and what carries over

Every provider follows one shape (see the Brevo spec, SCRUM-468): a connect start and callback
in `gateway/auth.ts`, `connectUser` for the session or a spent connect link, a one-shot nonce,
the verified-email rule for a link-only connect, the duplicate check, `upsertServiceAccount`
(sealed tokens), `REFRESH_FN` and `REVOKE_FN`, a plugin that receives the token in
`X-User-Token`, and the connect-link maps, one entry per provider.

What PostHog adds:

1. **No client secret.** The client id is a URL we serve, and the code exchange proves itself
   with PKCE. No provider today uses PKCE at the gateway.
2. **A project, not only an account.** A PostHog token is granted on chosen projects, and every
   API path names one. The plugin is handed the project and the regional host beside the token
   (section 4), which no plugin needs today.

## 1. The metadata document

`GET /oauth/posthog/client.json`, an Express route in `server.ts` mounted before the Next
catch-all, built by `posthogClientMetadata(baseUrl)` in `gateway/posthog-oauth.ts`:

```json
{
  "client_id": "<base>/oauth/posthog/client.json",
  "client_name": "DataToRAG",
  "client_uri": "<base>",
  "logo_uri": "<base>/datatorag-logo-256.png",
  "redirect_uris": ["<base>/auth/posthog/connect/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none",
  "com.posthog": { "scopes": ["openid", "email", "project:read", "query:read", "insight:read",
    "dashboard:read", "person:read", "error_tracking:read"] }
}
```

- The `client_id` is built from the same `baseUrl` as the route, so the two cannot differ;
  PostHog requires them equal character for character.
- `Cache-Control: public, max-age=3600`. PostHog clamps max-age to between five minutes and a
  day and serves a stale copy while it refreshes, so a changed redirect or scope is live within
  the hour.
- PostHog requires a 200 with no redirect, under five seconds, at most 5 KB. A test holds the
  size and that the route answers without a session.
- The `com.posthog.scopes` ceiling is set so the client can never be granted more than the
  connector asks for, even by a hand-built authorize URL.
- `client_name` may not contain "PostHog", "official", "verified" or "trusted".

## 2. The connect

**Configuration.** One new key, `POSTHOG_BASE_URL`, default `https://us.posthog.com`, through the
usual hops (schema, compose environment list); it is not a secret, so no parameter store entry.
The gateway refuses to start if it is not one of `https://us.posthog.com` and
`https://eu.posthog.com`, because the plugin is handed this value as the host to send a token to.

**Routes**, in `auth.ts`, in the Brevo pair's shape:

- `GET /auth/posthog/connect`: `connectUser`, `serviceOfferedTo` (fails closed),
  `stashAttribution`, `stashConnectNext`, a nonce cookie `posthog_connect_nonce`, a PKCE verifier
  in an HttpOnly cookie `posthog_connect_pkce` (43 to 128 URL-safe characters from
  `crypto.randomBytes`), `armDuplicateAck` (both cookies `Secure`, `SameSite=Lax`, ten minutes, path
  `/auth/posthog/connect`, as the sibling connect cookies), then a redirect to `<host>/oauth/authorize/` with
  `client_id`, `redirect_uri`, `response_type=code`, the scopes, `state`, `code_challenge`,
  `code_challenge_method=S256` and `required_access_level=project`.
- `GET /auth/posthog/connect/callback`: the one-shot consumers first (the PKCE cookie joins
  them; `auth-callback-ordering.test.ts` gains the route), the nonce check, the
  `serviceOfferedTo` re-check, then the exchange at `<host>/oauth/token/` (form body:
  `grant_type`, `code`, `redirect_uri`, `client_id`, `code_verifier`; no secret), then the
  project, the identity and the usual tail.

**The project.** `required_access_level=project` makes the consent screen ask for projects. The
token response carries `scoped_teams`. The callback requires **exactly one**; zero or several is
refused with "Choose one PostHog project when you connect", nothing stored. One connection is one
project: its id is the account's `externalAccountId`, as a Notion workspace id is, so a second
project is a second account under the same email. The label is the project's name from
`GET <host>/api/projects/{id}/`, cleaned by `untrusted-text.ts`.

**Identity.** The email from `<host>/oauth/userinfo/`. PostHog does not document an
`email_verified` claim; the rule stays `=== true`, so if the claim is absent a link-only connect
is refused and the user signs in first. A signed-in connect is unaffected. The build records what
the first live connect returns.

**Tokens.** PostHog's source gives a metadata-document client a seven-day access token and a
refresh token that does not rotate and does not expire with age (valid until revoked); the
`expires_in` in the response is stored as the expiry, never assumed. The token response's
`posthog_base_url` is compared with `POSTHOG_BASE_URL` and a mismatch is refused.

- `refreshPostHogToken` through `refreshRotatingToken`: form body `grant_type=refresh_token`,
  `refresh_token`, `client_id`. Rotation is off today, but the row lock costs nothing and keeps a
  later change on PostHog's side from losing a token.
- `REVOKE_FN` posts the refresh token to `<host>/oauth/revoke/` with `client_id`.

## 3. The audience gate

`CONNECTABLE_SERVICES` entry `posthog` with `audience: "admin"` and `launchPluginSlug:
"posthog-mcp"`. Every connect surface already reads `offeredServiceIdsFor` and `serviceOfferedTo`;
`isPublicTool` already leaves out an admin-only plugin's tools. No new code, one entry, and a test
that a non-admin sees PostHog nowhere.

## 4. What the plugin is handed

Today the gateway sends a plugin one header, `X-User-Token`. A PostHog call also needs the host
and the project.

- The service entry gains an optional `pluginContext(account) => Record<string, string>`; only
  PostHog declares it, returning `X-PostHog-Host` (from `POSTHOG_BASE_URL`) and
  `X-PostHog-Project` (the account's `externalAccountId`).
- `resolveServiceToken` already selects the account row; it returns `externalAccountId` beside the
  token, and `callPluginToolOnce` adds the context headers to the one-shot request.
- The plugin refuses a host header whose parsed origin is not one of the two regional hosts and a project that is
  not digits, before any call. The token is never sent anywhere else.

## 5. The plugin

`plugins/posthog-mcp`, the `notion-mcp` shape: `index.ts` (`/health`, `/mcp`, the headers read
once per session), `create-server.ts`, `posthog-client.ts`, `tools/posthog-read.ts`,
`error-meta.ts`.

**The client.** Paths are templates with values beside them, so a log line prints the template.
Every path is under `/api/projects/{project}/`. 401 says reconnect, 403 says the project or scope
was not granted, 429 says when to retry. A read's 429 is retried once if `Retry-After` fits an
eight-second budget, as Brevo's is. At most two calls run at once per session, under PostHog's
three concurrent queries per project.

**Query calls** post `{ query, name: "datatorag:<tool>", refresh: "blocking" }`, so each reads
plainly in PostHog's query log.

**Caps.** Every result is shaped to named fields and capped in rows; the text is capped at 50,000
characters with `truncated: true` and the count it dropped.

| Tool | Arguments | Wraps | Cap |
|---|---|---|---|
| `posthog_project_get` | none | `GET /api/projects/{id}/` | id, name, organization, timezone, enabled products. Never the project's API token or its test-account filter values |
| `posthog_trends_query` | `series` (1 to 5 of `{event, math?, properties?}`), `date_from`, `date_to` (both required), `interval?`, `breakdown?`, `filter_test_accounts?` (default true) | `/query/`, `TrendsQuery` | 25 breakdown values |
| `posthog_hogql_query` | `query` (one `SELECT`), `limit?` (default 100, max 1,000) | `/query/`, `HogQLQuery` | `LIMIT` appended or clamped |
| `posthog_insights_list` | `search?`, `saved?` (default true), `limit?` (20, max 100), `offset?` | `GET /insights/` | id, short_id, name, description, last_refresh |
| `posthog_insight_get` | `insight_id` or `short_id`, `refresh?` (default `force_cache`) | `GET /insights/{id}/` | definition plus 100 result rows |
| `posthog_events_list` | `date_from`, `date_to` (required), `event?`, `properties?` (up to 5 equalities), `person_id?`, `limit?` (50, max 200) | `/query/`, HogQL on `events` | uuid, event, timestamp, distinct_id, 20 properties each |
| `posthog_persons_search` | `search`, `limit?` (20, max 100) | `GET /persons/?search=` | id, 5 distinct ids, created_at, 20 properties |
| `posthog_dashboards_list` | `search?`, `pinned?`, `limit?` (20, max 100) | `GET /dashboards/` | id, name, description, pinned, tile count |
| `posthog_error_issues_list` | `date_from` (required), `date_to?`, `status?`, `order_by?`, `limit?` (20, max 100) | `/query/`, `ErrorTrackingQuery` | id, name, status, occurrences, users, first and last seen |
| `posthog_web_overview` | `date_from`, `date_to` (required), `compare?`, `filter_test_accounts?` | `/query/`, `WebOverviewQuery` | the KPI rows |

- **`date_to` is required** wherever a range is: an open end means "now" and a weekly number
  drifts.
- Trends and web overview take a small flat subset of PostHog's query schema, mapped by the
  plugin; HogQL covers anything else.
- `posthog_events_list` builds its HogQL with every value as a query parameter (`placeholders`),
  never spliced. The HogQL tool runs the model's own `SELECT` under the user's own token and
  grant, which is what PostHog's own MCP does.
- Every tool: `readOnlyHint: true`, `additionalProperties: false`, no em-dash in a description
  (a test holds it).

## 6. Packaging

The checklist, one entry each: the Dockerfile (files and `plugin-posthog-mcp` at uid and gid
906), `scripts/gate.sh`'s path table and self-test, `PLUGIN_SERVICE_MAP`, `CONNECTABLE_SERVICES`,
`SERVICE_PRESENTATION`, `PROVIDERS`, the connect-link maps, `CONNECTORS_WITHOUT_SCOPES` (the
scopes are fixed by the document's ceiling), `KNOWN_READ_TOOLS`, the classification snapshot,
the logo, the plugin README, and the registry pair `pnpm registry:diff posthog-mcp --new-plugin`
(ten inserts and the server row), which HQ runs. No docs page, changelog or `/tools` page while
it is admin-only.

## 7. Runner

A `posthog` scenario against HQ's own project, read-only, with fixture keys for the project id
and one known saved insight:

- PH1 `posthog_project_get` names the fixture project.
- PH2 `posthog_trends_query` with an explicit `date_to` returns one series.
- PH3 `posthog_hogql_query` with a `LIMIT` above the cap comes back clamped.
- PH4 `posthog_insight_get` on the fixture insight returns its name.

No send-guard rules: nothing writes. Public status titles for each case.

## Tests, by section

- Document: the JSON's `client_id` equals the URL it is served at, the size is under 5 KB, the
  cache header, no redirect, no session needed, the scope ceiling equals the connect's scopes.
- Connect: the start's PKCE challenge is the S256 of the cookie's verifier; the callback for each
  outcome (one project stored, zero or several refused, link-only with and without
  `email_verified`, duplicate, refused exchange, host mismatch); the ordering test extended; a
  non-admin refused at start and at callback.
- Config: the gateway refuses a `POSTHOG_BASE_URL` outside the two hosts.
- Context headers: sent only for a service that declares them, carrying the account's project.
- Refresh: through the real-Postgres rotating-lock test, as Brevo's.
- Plugin: each tool's request shape against a stubbed fetch, every cap, the host and project
  refusals, the HogQL `LIMIT` clamp, parameters never spliced into the events query, 401, 403 and
  429 with and without a near retry, and the annotations of every tool.

## The ask

**For us:** one connection beside the other five; the gateway's approval gate and usage record on
every call; the dashboard agent reaching PostHog through the same door with a token we hold sealed,
instead of a long-lived API key.

**For a public user, little.** PostHog's own MCP is free, already OAuth, and serves over a
thousand tools with read-only and project pinning. Ours would be ten read tools from a company
PostHog has not reviewed, on an endpoint PostHog says connectors should not use. So it stays
admin-only, with no public plan.

**Ask PostHog before any public release.** In writing: whether an interactive connector on
`/query` falls under the connector line, and app verification at the same time.
