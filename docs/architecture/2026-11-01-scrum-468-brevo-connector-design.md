# A Brevo connector (SCRUM-468)

Status: spec, written from the code at `a965a5a2`. Nothing here is built until a go. The
questions that need a ruling are collected at the end.

Brevo becomes a fourth provider beside Google Workspace, Atlassian and Notion: a `brevo-mcp`
plugin in the `notion-mcp` shape, twenty tools over Brevo's v3 API, connected by OAuth. It
ships first for our own Brevo organisation, through a **private** Brevo app; a public app goes
through Brevo's review in parallel, so the same code can be offered to anyone later by changing
one entry. A separate small change serves `destructiveHint` to MCP clients, because Brevo's two
sends are the first tools that need it said.

## Rulings this spec builds on

- **OAuth, not a pasted API key.** Brevo's developer terms rule out storing a user's API key,
  and a key is account-wide, is deactivated after ninety days unused, and can be locked out by
  Brevo's automatic IP blocking. OAuth tokens are scoped to what we ask for.
- **A private app now, the public app reviewed in parallel.** A private app can only be
  authorized by accounts in our own Brevo organisation and needs no review.
- **Twenty tools in the first release** (below). `image_upload`, `template_update`,
  `template_send_test` and `list_create` follow in a second.
- **`destructiveHint` is served to clients**, as its own pull request in the same release.

## What the code does today, and what carries over

Every provider today follows one shape, and Brevo fits it without a new kind of flow:

- A connect start and callback in `gateway/auth.ts`: the session (or, since SCRUM-466, a spent
  connect link) says who the connect is for, a one-shot nonce binds the round trip, the callback
  clears its one-shot cookies first, then exchanges the code, resolves the account's identity,
  runs the verified-email rule for a link-only connect and the duplicate-account check, and calls
  `upsertServiceAccount`, which stores the tokens sealed (SCRUM-442).
- Tokens are resolved per call by `resolveServiceToken`, refreshed through `REFRESH_FN` when
  expired, and revoked upstream through `REVOKE_FN` on disconnect.
- A plugin receives the token in `X-User-Token`, calls its provider, and reports failures in
  `_meta["datatorag.com/error"]`, which the gateway's usage classifier reads.
- The `connect` tool, connect links and URL elicitation work per provider through a small set of
  maps (`DuplicateProvider`, `CONNECT_START`, the page nouns), so a new provider is one entry in
  each.

What Brevo adds that Notion did not need: **hour-long access tokens with a refresh token** (as
Atlassian), and **refresh tokens that may be replaced on refresh** (Brevo's guide says to store a
new one when it is returned), so the refresh takes Notion's row lock.

## 1. The OAuth connect

**App registration (HQ's, outside the repo).** A private Brevo app, created with Brevo's CLI
under our organisation, with redirect URI `<base>/auth/brevo/connect/callback` and these scopes:

```
account:read contacts:read contacts:write campaigns.email:read campaigns.email:write
transactional.email:read transactional.email:write offline_access openid email
```

`write` does not imply `read` in Brevo, so both are asked for. The public app is registered the
same way with the PKCE variant; the code handles both (below).

**Configuration.** Two new keys, `BREVO_OAUTH_CLIENT_ID` and `BREVO_OAUTH_CLIENT_SECRET`, through
the usual hops: the config schema, the parameter store, the host render and the production
compose environment list, checked on the host after the deploy. They are separate from the
existing `BREVO_API_KEY`, which sends DataToRAG's own lifecycle email and has nothing to do with a
user's connection.

**Routes**, in `auth.ts`, in the Notion pair's shape:

- `GET /auth/brevo/connect`: `connectUser` (session, or a spent link for this provider), the
  audience gate (section 3), `stashAttribution`, `stashConnectNext`, a nonce cookie
  `brevo_connect_nonce`, `armDuplicateAck`, then a redirect to
  `https://oauth.brevo.com/realms/partner/oauth/authorize` with `client_id`, `redirect_uri`,
  `response_type=code`, the scopes above, and `state`.
- `GET /auth/brevo/connect/callback`: the one-shot consumers first (nonce, attribution, next,
  duplicate acknowledgement, connect link; `auth-callback-ordering.test.ts` gains the route),
  then the nonce check, the code exchange at `.../oauth/token` (form body with `client_secret`
  for the private app), then the identity, then `refusedUnconfirmed`, `refusedAsDuplicate`,
  `upsertServiceAccount`, `trackOAuthCompleted`, `connected()`, and the redirect through
  `postConnectDestination`.

**Identity.** The account's email comes from Brevo's `userinfo` endpoint (`openid email`), with
`email_verified` read; the label is its company name from `GET /v3/account`, cleaned by
`untrusted-text.ts`. As built, the account is keyed by its email, as Google's and Atlassian's
are, because `GET /v3/account` documents no organisation id. For the link-only rule the address
counts as verified only when Brevo says `email_verified: true`, as for Google and Atlassian; a
missing claim is not verified.

**Public app, later.** The public app sends a PKCE `code_challenge` on authorize and a
`code_verifier` instead of the secret on the exchange and the refresh. The verifier is held in an
httpOnly one-shot cookie beside the nonce. Which app a connect uses is one configuration choice;
the routes are the same.

## 2. Tokens: refresh and revoke

- `REFRESH_FN.brevo`: `grant_type=refresh_token` at `.../oauth/token`, under the row lock Notion's
  refresh uses (read `FOR UPDATE`, reuse a token that already moved, write the new pair inside the
  lock, re-read before calling a rejected grant dead), because a refresh may return a new refresh
  token. A concurrent test on real Postgres pins it, red without the lock.
- `REVOKE_FN.brevo`: Brevo's `.../oauth/revoke`, never blocking a disconnect.
- A refresh token lasts thirty days. Whether that is absolute or renewed by each refresh is not
  documented, and the build measures it on the private app before release: if absolute, a monthly
  reconnect is a fact the connections page states, and `connectionDead` already turns a refused
  refresh into `needs_reconnect`.

## 3. Who is offered Brevo while the app is private

A private app can only be authorized by accounts in our Brevo organisation; anyone else would meet
Brevo's own error after leaving us. So Brevo is offered only to admins (`users.role = 'admin'`)
until the public app is approved:

- `CONNECTABLE_SERVICES` gains `audience?: "admin"`, set on Brevo, beside the existing
  `launchPluginSlug` launch gate.
- One function, `serviceOfferedTo(db, serviceId, userId)`, joins the launch gate and the audience,
  and every surface that offers a connect reads it: the dashboard's cards and service page, the
  agent's `request_connection` and empty state, the `connect` tool, the server instructions'
  provider list, and the connect start route, which refuses with `CONNECT_ERROR_NOT_LAUNCHED`.
- Opening it to everyone is removing one field, after the public app is live.

This is the same rule the built-in registry already uses for admin-only tools (`audience:
"admin"`), applied to a service.

## 4. The plugin

`plugins/brevo-mcp`, in the `notion-mcp` shape: `create-server.ts`, `index.ts` reading
`x-user-token` per session, a `brevo-client.ts`, `error-meta.ts`, `rate-limit-retry.ts`,
`tools/annotations.ts` with READ, WRITE and MUTATE, and `tools/response.ts` with the 900 KB cut
and `truncate`.

**The client.** Base `https://api.brevo.com/v3`, `Authorization: Bearer <token>`, a 60-second
timeout. Errors:

- 401: the reconnect wording, which the gateway's not-connected helper (SCRUM-466) turns into a
  connect link.
- 402: "Brevo refused for lack of credits or today's send limit" with the detail Brevo gave.
- 429: Brevo answers with `x-sib-ratelimit-reset`; a read waits and retries only when the reset
  is within the 8-second budget, otherwise every call answers at once with "Brevo's limit for
  this kind of call is used up; it resets in N minutes", marked transient so it is never metered.
  Writes are never retried.
- 5xx and network failures are never retried; a write that got no answer is reported as "may
  have been applied".
- Log lines carry the path shape only, never a body or a parameter.

**Rate limits shape the tools.** Below Brevo's Professional plan, campaign and account endpoints
allow 100 calls an hour per account, templates and statistics 300, contacts 36,000. The tools
never fan out: one tool call is one Brevo call, except `campaign_send`, which reads the account's
send limit first (two calls).

### The twenty tools

R is declared read-only, W a write, X a write that cannot be undone.

| Tool | Brevo | Kind |
|---|---|---|
| `account_get` | `GET /account` | R |
| `contacts_search` | `GET /contacts`, or `GET /contacts/lists/{id}/contacts` with `list_id` | R |
| `contact_get` | `GET /contacts/{identifier}` | R |
| `contact_create` | `POST /contacts` | W |
| `contact_update` | `PUT /contacts/{identifier}` | W |
| `lists_get` | `GET /contacts/lists` or `/{id}` | R |
| `list_members_update` | `POST /contacts/lists/{id}/contacts/add` and `/remove` | W |
| `campaigns_list` | `GET /emailCampaigns?excludeHtmlContent=true` | R |
| `campaign_get` | `GET /emailCampaigns/{id}` | R |
| `campaign_create` | `POST /emailCampaigns` | W |
| `campaign_update` | `PUT /emailCampaigns/{id}` | W |
| `campaign_send_test` | `POST /emailCampaigns/{id}/sendTest` | W |
| `campaign_send` | `POST /emailCampaigns/{id}/sendNow`, or `PUT` with `scheduledAt` | X |
| `campaign_set_status` | `PUT /emailCampaigns/{id}/status` | W |
| `campaign_export_recipients` | `POST /emailCampaigns/{id}/exportRecipients` | R |
| `process_get` | `GET /processes/{id}` | R |
| `email_stats` | `GET /smtp/statistics/aggregatedReport` | R |
| `templates_get` | `GET /smtp/templates` or `/{id}` | R |
| `email_send` | `POST /smtp/email` | X |
| `email_log` | `GET /smtp/statistics/events` | R |

Argument shapes are snake_case and plain values (`list_ids`, `scheduled_at` as an ISO string);
each tool's input schema says which are required, and nothing is accepted that the tool does not
use.

**Notes per tool:**

- `contacts_search`: Brevo's only filter operator is `equals(ATTR,"value")`, which the
  description says. `limit` is capped at 100 here, `offset` pages.
- `campaign_get`: `statistics` names Brevo's report kinds (`globalStats`, `linksStats`,
  `statsByDomain`, `statsByDevice`, `statsByBrowser`), so "report" and per-campaign stats are
  this tool. HTML only with `include_html`, cut at `max_html_chars` with the marker `gmail_read`
  uses.
- `campaign_update` refuses `scheduled_at`: scheduling is a send, and has one tool.
- `campaign_export_recipients` starts Brevo's asynchronous export and answers with the process
  id; `process_get` answers with its status and, when done, the address of the file Brevo hosts.
  The file's bytes do not cross the gateway in this release. It is declared a read: it changes no
  campaign, contact or send.
- `templates_get`: a list drops each template's HTML, which Brevo returns with no flag to exclude
  it; one template returns HTML only with `include_html`, capped.
- `email_log`: Brevo's default page is 2,500 events, so `limit` is capped at 100 with `offset`.
- `campaign_send_test` and the template test are limited by Brevo to fifty a day; the description
  says so.

### Sends that cannot be undone

`campaign_send` and `email_send`:

- carry MUTATE: `readOnlyHint: false`, `destructiveHint: true`;
- open their description with what they do to whom and that it cannot be recalled:
  "Sends campaign N to every recipient on its lists, now or at `scheduled_at`. A sent campaign
  cannot be recalled; a scheduled one can be stopped with campaign_set_status."
- `campaign_send` reads the account's remaining send limit first and answers with the campaign's
  recipient count and that limit, and refuses in words, sending nothing, when the limit left is
  smaller than the recipient count (the free plan's daily cap would otherwise deliver to part of
  the list and leave the rest for a manual requeue);
- no `confirm: true` argument: a model fills it in itself, so it proves nothing. The dashboard
  agent already asks before any tool whose name carries `send`; an external client decides from
  the hints.

## 5. Serving `destructiveHint` (its own pull request)

Today the registry stores one annotation, `read_only_hint`, and `tools/list` serves it alone, so a
client cannot tell a reversible write (`contact_update`) from one that cannot be undone
(`campaign_send`). The MCP specification defaults `destructiveHint` to true for any tool that is
not read-only, so every write currently reads as destructive to a client that looks.

- `tools.destructive_hint` (boolean, null when the plugin did not say), generated with
  `db:generate`.
- `discoverTools` captures `annotations.destructiveHint` beside `readOnlyHint`.
- `scripts/registry-diff.mjs` diffs, inserts and updates the field with the same md5-guarded
  shape as `read_only_hint`, and its tests cover it.
- `tools/list` serves `destructiveHint` beside `readOnlyHint` only when the row holds a value and
  the tool is not read-only.
- Like `read_only_hint`, it is recorded and never trusted: the agent's approval gate keeps
  deciding from the name.
- Existing rows get their values from their plugins' own annotations through the usual
  generated registry pair per plugin, HQ's to run; until then the column is null and nothing
  changes for any client.

## 6. Packaging

The `notion-mcp` checklist, one entry each: the Dockerfile (files and a `plugin-brevo` account),
`scripts/gate.sh`'s path table and self-test, `PLUGIN_SERVICE_MAP`, `CONNECTABLE_SERVICES` with
`launchPluginSlug` and `audience`, `SERVICE_PRESENTATION`, `PROVIDERS`, the connect-link maps,
`CONNECTORS_WITHOUT_SCOPES` (Brevo's scopes are fixed at the app, not untickable on its consent
screen), `KNOWN_READ_TOOLS`, the classification snapshot, logos and icons, the docs page modelled
on the Notion one ("available for our own workspace" until the public app), the `/tools/brevo`
page from the plugin README, the registry pair with the server row
(`pnpm registry:diff --new-plugin`), and a changelog entry when it is offered to anyone.

## 7. Runner

A `brevo` scenario against a test Brevo account on the free plan, kept well under the hourly
limits:

- BR1 connects and lists campaigns; BR2 a contact read round trip and a list's members; BR3 a
  contact created, updated and restored under the run stamp; BR4 a draft campaign created,
  updated and set back, with one `campaign_send_test` to the reader mailbox; BR5 the stats and
  the log read.
- The send guard gains Brevo rules: tests send only `campaign_send_test` and only to the reader
  mailbox; `campaign_send` and `email_send` are never called by a case, and are listed as
  uncovered on purpose with that reason.
- Public status titles for each case.

## Overlap with the Slack connector

Built in parallel on its own branch. Both touch: `CONNECTABLE_SERVICES`, `SERVICE_PRESENTATION`,
`PLUGIN_SERVICE_MAP`, `PROVIDERS`, the connect-link maps, `CONNECTORS_WITHOUT_SCOPES`, the
`connect` tool's description and the server instructions' provider list, `list_connected_accounts`
copy, `server.json`, the Dockerfile's plugin accounts (each takes the next free uid), `gate.sh`,
the docs navigation, the registry pair and the changelog. Whichever lands second rebases and says
so; neither resolves the other's entries. The `audience` field in section 3 is new and Slack may
want it too.

## Tests, by section

- Connect: the start and callback for each outcome (session, link-only with the verified-email
  rule, duplicate, refused exchange), the ordering test extended, the audience gate refusing a
  non-admin at the start route and hiding Brevo on every surface.
- Refresh: the concurrent test on real Postgres, red without the lock; a refused refresh marks the
  connection for reconnect.
- Plugin: each tool's request shape against a stubbed fetch, the caps (HTML, page sizes), each
  error mapping (401, 402, 429 with and without a near reset, 5xx on a write), `campaign_send`'s
  pre-check refusing when the limit is short, and the annotations of every tool.
- `destructiveHint`: discovery captures it, the diff tool round-trips it, `tools/list` serves it
  only for a non-read-only row that holds a value.
- No copy with an em-dash, held by a test where the copy is in code.

## Ruling questions

1. **The audience gate while the app is private.** Recommended: admins only, through a new
   `audience` field on the service entry. Alternative: an allowlist of sign-in emails in
   configuration, as `gws_run` has.
2. **`campaign_send`'s pre-check.** Recommended: refuse when the send limit left is below the
   recipient count. Alternative: answer with both numbers and send anyway.
3. **Exports.** Recommended: hand back the address of the file Brevo hosts. Alternative, later:
   carry the bytes through `file_download_link`.
