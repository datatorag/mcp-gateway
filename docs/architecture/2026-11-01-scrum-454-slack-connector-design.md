# Slack connector, own workspace first (SCRUM-454)

Date: 2026-11-01. Status: design, not started. Plan:
`docs/plans/2026-11-01-scrum-454-slack-connector.md`.

## Ask

Connect our own Slack workspace to the gateway, so Slack works in the same
conversation as the other connectors, with no separate connector set up
in each client. This is for the company's own use first. It is not a
public connector: no Marketplace listing and no public distribution.
Opening it to other workspaces is a separate decision with its own
design.

### Success criteria

- An admin of the gateway connects their Slack account in the company
  workspace from the connections page or the `connect` tool. Both
  surfaces show Slack to admins only.
- Ten tools (section 3) work through the gateway: six reads and four
  writes.
- The writes cannot post to a channel or person the model did not name
  in words. Every write is classified as a write, so the client asks
  first.
- A grant from any other Slack workspace is refused at the callback,
  even if the Slack side were misconfigured.
- Nothing from Slack is stored except the encrypted tokens and the
  grant's identity.

## Recommendation

An **internal Slack app** registered in the company workspace, with
public distribution left off, and **our own plugin** (`slack-mcp`) calling
Slack's Web API with the **user token**. It follows the `notion-mcp` plugin
in every place the two can match.

## 1. Shape

### (a) Our own plugin on the Web API. Recommended.

- Every gateway pattern applies unchanged: the registry, write
  classification, per-account routing, trimmed responses, the
  expected-target guard, the test runner and metering.
- Slack documents that internal, customer-built apps keep the standard
  rate tiers. The 2025 reduction to one history read a minute and fifteen
  messages per call applies to commercially distributed apps outside the
  Marketplace, not to internal ones.
- Slack's terms for commercial distribution do not come into it, because
  nothing is distributed.

### (b) Proxy Slack's hosted MCP server. Not recommended now.

Slack's hosted MCP server accepts Marketplace and internal apps, so an
internal app could reach it. It is not chosen because:

- The gateway has no remote-MCP proxy today. Every connector is a plugin
  we run.
- We would not control the tool names, descriptions, response sizes or
  the write guard. The write classification would rest on names someone
  else can change.
- Rate limits are the same as the Web API's, so the proxy saves no
  budget.

If the plugin's tool surface ever lags far behind the hosted one, the
choice is revisited. It is not a stage.

## 2. Auth

### What Slack gives us

From Slack's OAuth v2 and token rotation documentation:

- **Authorize** at `https://slack.com/oauth/v2/authorize` with
  `client_id`, `user_scope` (comma-separated), `redirect_uri` and
  `state`. Bot scopes go in `scope`; this design requests none (see
  below).
- **Exchange** at `POST https://slack.com/api/oauth.v2.access` with the
  code and client credentials. The response carries:
  - `team {id, name}` and `enterprise` (null outside Enterprise Grid);
  - `is_enterprise_install`;
  - `authed_user {id, scope, access_token, token_type: "user"}`.
- **Token rotation**, when turned on for the app:
  - Access tokens expire after 12 hours (`expires_in`) and come with a
    `refresh_token`.
  - Each refresh token can be used once, and the refresh returns a new
    pair.
  - Refresh is the same method with `grant_type=refresh_token`.
  - Turning rotation on cannot be undone for the app.
- **Errors:** responses are HTTP 200 with `ok: false` and an `error`
  string (`invalid_auth`, `token_expired`, `missing_scope`,
  `ratelimited`, `not_in_channel`, ...). A 429 carries `Retry-After` in
  seconds.
- **Revoke:** `auth.revoke` with the token.
- **A non-distributed app** can be installed only in the workspace that
  owns it.

### Token: the user token only

Every tool acts as the person, as the other connectors do.

- `search.messages` accepts only a user token. A bot cannot search.
- A user token reads the public channels and the user's own private
  channels and DMs, so no bot invitations are needed.
- Posting with a user token posts as the person, the way `gmail_send`
  sends as them.

No method in section 3 needs a bot token, so the app requests no bot
scopes. If a later tool needs one, it is added then and both tokens are
stored.

### User scopes

The full set is requested at registration, because adding one later
makes every connected user reconnect:

- **Reading channels:** `channels:read`, `groups:read`, `im:read`,
  `mpim:read`.
- **Reading history:** `channels:history`, `groups:history`,
  `im:history`, `mpim:history`.
- **Search:** `search:read`.
- **Writing:** `chat:write`, `reactions:write`, `im:write` (to open a
  DM).
- **People and files:** `users:read`, `users:read.email`, `files:read`.

### How it maps onto the gateway

- **Ids:** service id `slack`, plugin slug `slack-mcp`. Added to
  `PLUGIN_SERVICE_MAP`, `PROVIDERS` and `CONNECTABLE_SERVICES` (with
  `launchPluginSlug: "slack-mcp"`).
- **Routes:** `GET /auth/slack/connect` and
  `/auth/slack/connect/callback` in `auth.ts`, copied in shape from the
  Notion pair: session or connect-link user, launch gate, CSRF nonce in
  an httpOnly cookie echoed in `state`, duplicate acknowledgement. The
  nonce cookie is cleared before any return, and
  `auth-callback-ordering.test.ts` gains the row.
- **The callback refuses**, before storing anything:
  - a missing or mismatched nonce;
  - `ok: false`;
  - `is_enterprise_install: true`;
  - a `team.id` that is not `SLACK_CONNECTOR_TEAM_ID`.

  The last check is the gateway's own guarantee that only the company
  workspace connects. The app's distribution setting is the first
  guarantee; this is the second, and it holds even if that setting is
  ever changed.
- **Identity:**
  - The account email comes from `users.info` for `authed_user.id`,
    called with the new user token (`users:read.email`).
    `connected_accounts.account_email` is NOT NULL, so a grant with no
    email is refused with a reason rather than stored.
  - `external_account_id` is the team id and `label` is the team name.
    This is the Notion multi-workspace shape, already in the schema.
- **Storage** is unchanged: tokens in the sealed columns of
  `service_connections`, identity in `connected_accounts`. Neither table
  enumerates services, so there is no migration.
- **Refresh** is `refreshSlackToken` in `REFRESH_FN`:
  - It takes the row lock the Notion refresh takes, because a refresh
    token works once and two concurrent refreshes would end the
    connection.
  - `token_expires_at` is set from `expires_in`.
  - `invalid_grant`, `invalid_refresh_token` and `token_revoked` are
    permanent. Everything else is transient.
- **Disconnect:** `revokeSlackGrant` in `REVOKE_FN` calls `auth.revoke`
  with the access token.
- **Grant honesty:**
  - Slack's consent screen is all or nothing, so the stored scopes equal
    the requested ones, and Slack joins the connectors that
    `scope-grant.ts` answers "complete" for.
  - A `missing_scope` error from the API is rewritten by the plugin into
    "reconnect Slack", because it can only mean the app's scopes changed
    after the grant.
- **Analytics redaction:** Slack's envelope is `{ok: false, error}`.
  `usage/redact.ts` gets a Slack case that keeps `error` (a short code)
  and nothing else from the body.
- **Config:** the names must be impossible to confuse with the internal
  notification bot's existing `SLACK_BOT_TOKEN`. Three keys:
  - `SLACK_CONNECTOR_CLIENT_ID`
  - `SLACK_CONNECTOR_CLIENT_SECRET`
  - `SLACK_CONNECTOR_TEAM_ID`

  Each goes through all four hops: the config schema, the parameter
  store, the host render and the production compose file's environment
  list. Without all three keys, the connect route answers "not
  configured" and the service is not offered.

### Who sees it: an admin audience on a connectable service

> Superseded by the shared `offeredServiceIdsFor`/`serviceOfferedTo` helper from the Brevo connector (SCRUM-468); `launchedServiceIds` stays global and Slack rides on that helper.

The launch gate (`service-launch.ts`) is global: once the plugin's
`mcp_servers` row is active, every user is offered the service. A Slack
card shown to every user would fail at Slack's consent screen for anyone
outside the company workspace. So:

- **The new field.** `ConnectableService` gains an optional
  `audience?: "admin"`, the same word built-in tools already use for the
  same purpose. The Slack entry sets it.
- **The gate.**
  - `launchedServiceIds(db, userId)` leaves out audience-gated services
    unless `isAdmin(db, userId)`. The role read happens only when such a
    service exists and has launched.
  - `isServiceLaunched(db, serviceId, userId)` follows.
  - Every caller already has the user id: the connect route, the
    connections view, the service detail page, the agent's
    `request_connection` and the `connect` tool.
- **Fails closed.** A role-read failure reads as not admin.
- **The `connect` tool's `service` enum** is built from the services
  with no audience, so the schema every client sees never names Slack.
  For an admin, the all-services report includes it.
- **Tool listing needs no change.** Slack tools are listed only to a
  user with a Slack connection, and only an admin can make one.

## 3. Tool surface

Every name carries the `slack_` prefix. Each existing tool names its
service in its prefix, and `connectorsFor` in `lib/skill-links.ts` maps
skills to connectors by that prefix; it gains a `^slack_` row.

### Reads

| Tool | What it does | Arguments | Wraps | Cap |
|---|---|---|---|---|
| `slack_channels_list` | Channels the user can see: id, name, privacy, member count, topic | `types?` (`public`, `private`, `im`, `mpim`; default public and private), `query?` (name contains), `limit?` (default 50, max 200), `cursor?` | `conversations.list` | 200 per page |
| `slack_messages_search` | Search the messages the user can see, with Slack's search syntax | `query`, `sort?` (`score` or `timestamp`), `count?` (default 20, max 50), `page?` | `search.messages` | 50 hits |
| `slack_channel_history` | Recent messages in one channel, newest first | `channel`, `oldest?`, `latest?`, `limit?` (default 20, max 100), `cursor?` | `conversations.history` | 100 messages |
| `slack_thread_read` | One message and its replies | `channel`, `ts`, `limit?` (default 50, max 200), `cursor?` | `conversations.replies` | 200 replies |
| `slack_users_lookup` | One person, by email or by user id | `email?` or `user_id?` (exactly one) | `users.lookupByEmail`, `users.info` | one profile |
| `slack_files_list` | Files shared in a channel or by a person, metadata only | `channel?`, `user?`, `types?`, `count?` (default 20, max 100), `page?` | `files.list` | 100 files, never file bytes |

How reads return results:

- **Channels** are accepted as an id or as `#name`. A name is resolved
  through `conversations.list` and refused if it matches more than one
  channel.
- **Message text** is trimmed per message to 2,000 characters, with the
  shared truncation marker. The whole response stays under the plugin's
  900 KB cap.
- **Mentions are resolved.** `<@U…>` and `<#C…|name>` come back as
  `@Display Name` and `#name`, so the model is not handed bare ids. The
  lookups are cached for the length of one call only.
- **Each message** carries `ts`, `user` (resolved name), `text`,
  `thread_ts`, `reply_count` and `permalink` when Slack gives one.
  Attachments and blocks are reduced to their text.

### Writes

| Tool | What it does | Arguments | Wraps |
|---|---|---|---|
| `slack_reactions_add` | Add an emoji reaction to a message | `channel`, `ts`, `name` | `reactions.add` |
| `slack_message_update` | Replace the text of a message the user posted | `channel`, `ts`, `text`, `expected_channel_name` | `chat.update` |
| `slack_message_post` | Post a message, or a reply in a thread, as the user | `channel`, `text`, `thread_ts?`, `expected_channel_name` | `chat.postMessage` |
| `slack_dm_send` | Send a direct message to one person as the user | `user` (id or email), `text`, `expected_user_email` | `conversations.open`, then `chat.postMessage` |

**The expected-target guard.** It follows `gmail_reply`'s `expected_to`,
except that the argument is **required** here:

- The plugin resolves `channel` (or `user`) first.
- It refuses, sending nothing, unless the resolved channel's name equals
  `expected_channel_name` (compared without a leading `#`,
  case-insensitive), or the resolved person's email equals
  `expected_user_email`.
- Why required: a post notifies people the moment it lands, and deleting
  it does not undo the notification. A human approving a call that shows
  `C04…` cannot tell a wrong channel from a right one; a name in words
  can be checked.

**Classification and annotations:**

- `slack_dm_send` (`send`), `slack_message_update` (`update`) and
  `slack_reactions_add` (`add`) are writes by the existing verb tokens.
- `slack_message_post` carries no verb token today, so `post` joins
  `WRITE_VERBS`. That follows the `duplicate` precedent rather than
  relying on the fail-closed default.
- The four writes carry the write annotation. `slack_message_post`,
  `slack_dm_send` and `slack_message_update` also carry
  `destructiveHint: true`. That takes effect for clients once the gateway
  serves `destructiveHint`, which is separate work; until then the write
  classification is the guard.
- The six reads go in `KNOWN_READ_TOOLS`, and the classification snapshot
  pins all ten.

### Later, each on a concrete request

Canvases, scheduled messages, file upload, message delete, and
channel join or leave.

## 4. Rate limits

Slack's per-method tiers apply to an internal app:

- **Tier 2 (about 20 a minute):** `conversations.list`,
  `search.messages`.
- **Tier 3 (about 50 a minute):** `conversations.history`,
  `conversations.replies`, `reactions.add`, `chat.update`, `files.list`,
  `users.lookupByEmail`, `conversations.open`.
- **Tier 4:** `users.info`.
- **Posting:** about one message a second per channel.

The plugin takes the retry rule the other plugins copy
(`rate-limit-retry.ts`):

- Retry only a rate refusal, and only for a read-only tool.
- At most three attempts, with `Retry-After` read as whole seconds.
- A write is never retried. A post that timed out may have landed, and
  the user is told so.
- The mention resolver's `users.info` calls count against Tier 4.

## 5. Data and terms

- **Stored:** the sealed access and refresh tokens, the expiry, the
  granted scopes, the team id and name, and the user's email. No message
  or file content, no cache and no index.
- **Slack's API terms:**
  - No training models on Slack data.
  - Keep and use only the data needed.
  - No bulk export.

  A passthrough connector meets all three.
- **In-product agent chat.** The chat stores each conversation, including
  what tools returned, as the other connectors' results are stored. Any
  copy about Slack data says so, rather than "never stored".

## 6. Gateway work

Each item mirrors the Notion connector.

- **Auth and tokens:**
  - `slack-oauth.ts` (endpoint constants and the exchange);
  - the route pair in `auth.ts`;
  - `PLUGIN_SERVICE_MAP`, `REFRESH_FN` and `REVOKE_FN`;
  - `PROVIDERS`;
  - router config in `server.ts`;
  - `ATTRIBUTED_PATHS`;
  - the duplicate-connect tables in `connect-duplicate.ts`;
  - the connect-link page.
- **Audience gate:** section 2.
- **Connect card:**
  - `CONNECTABLE_SERVICES` and the presentation row in `services.tsx`
    (it throws at load if a registry id has no row);
  - `SERVICE_ID_BY_CONNECTOR` and `connectorsFor`;
  - the agent's suggestion and part tables;
  - the status surfaces list.
- **Icon:** `slack` in `KNOWN_SERVICES`, the SVG with its provenance
  line, the server logo entry.
- **Packaging:**
  - `plugins/slack-mcp` as a workspace package;
  - the gateway Dockerfile's COPY lines and a `plugin-slack-mcp` system
    account on uid 905 (904 is the Brevo plugin's);
  - `scripts/gate.sh` row and self-test lines;
  - `datatorag.json` naming the three config keys.
- **Registry:** the generated pair, `registry:diff slack-mcp
  --new-plugin`, which inserts the `mcp_servers` row and the ten tool
  rows. Rows before the image, as always.
- **Write classification:** `post` in `WRITE_VERBS`, the reads in
  `KNOWN_READ_TOOLS`, the snapshot.
- **Test runner:**
  - a `slack` role;
  - `PLUGIN_ROLES["slack-mcp"]`;
  - a fixture test channel in `FIXTURE_KEYS`;
  - a case per tool.
- **Send guard:** a Slack rule. In a test run, writes may target only the
  fixture channel, and DMs only the test user's own DM. It is proven by
  an attempt to write elsewhere against the real handler.
- **Docs:** none public while the audience is admin: no docs page, no
  docs nav entry and no changelog entry (decided 2026-11-01).
  The skills (`codebase-map`, `gws-mcp-dev`, `gateway-dev`) gain the
  fourth connector and the `audience` field in the commits that add them.

## 7. Overlap with the Brevo connector

Specified in parallel on another branch. Whoever touches a shared file
second rebases and says so in the pull request:

- **The `connect` tool:** the description string names the providers,
  and the enum comes from `CONNECTABLE_SERVICES`.
- **Connect surfaces:** `CONNECTABLE_SERVICES`, `services.tsx` and
  `PROVIDERS`.
- **Dockerfile system accounts:** Brevo takes uid 904 and Slack 905.
- **The audience field:** the Brevo spec adds the same `audience` field
  and a `serviceOfferedTo` helper read on every surface. Whichever
  connector merges second reuses the first one's field and helper rather
  than adding a second gate.
- **`scripts/gate.sh`** path table.
- **The registry file pair:** each plugin has its own pair, but both are
  generated against the running sha, so the second is regenerated after
  the first deploys.
- **Write vocabulary:** `WRITE_VERBS` and the classification snapshot.
- **Docs and changelog:** docs nav (`CONNECTORS`) and the changelog.
- **`destructiveHint` serving:** the Brevo release carries the gateway
  change that serves it. Slack's annotations are written to use it and do
  not depend on it.

## 8. Risks and unknowns

- **Rotation.** Stage 0 confirms on the registered app that rotation
  returns `expires_in` and a `refresh_token` for a user-scope-only grant.
- **Email visibility.** `users.info` may withhold the email if the
  workspace hides it. In our own workspace this is a stage 0 observation.
- **`search.messages` is labelled legacy** in Slack's docs, in favour of
  the Real-time Search API, which internal apps may also use. If it is
  retired, `slack_messages_search` moves to `assistant.search.context`
  with its granular scopes, which means a reconnect.
- **Revoke reach.** Whether `auth.revoke` on the access token also kills
  the refresh token is observed in stage 0. If it does not, both are
  revoked, as Notion does.

## 9. Stages

- **Stage 0: registration and observation, no product code.**
  - The founder registers the internal app: user scopes from section 2,
    rotation on, two redirect URIs (the production and local dev
    callbacks), distribution off.
  - The three keys reach the local environment and the parameter store.
  - The four unknowns in section 8 are observed against the real app.
- **Stage 1: connect and reads.**
  - The audience gate, the connect pair, refresh and revoke.
  - The plugin and its six reads, with runner cases.
- **Stage 2: writes.**
  - The four writes with the guard, `WRITE_VERBS`, the send-guard rule
    and runner cases.
- **Stage 3: rollout.**
  - The registry pair is generated against the running sha.
  - HQ runs it and deploys on the founder's go.
  - The founder connects.

## Decided

- 2026-11-01: no public docs page, docs nav entry or changelog entry
  while only admins can connect.

## Open questions

1. **Bring-your-own app for other workspaces.** That would need per-user
   client credentials in storage, which this design does not add. It is
   out of scope and recorded so the `audience` field is not mistaken for
   the whole path to opening it.
