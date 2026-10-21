# Notion connector (SCRUM-366)

Date: 2026-10-02, refreshed 2026-10-20 against main at `d85d087`. Status:
design only. Nothing here is built. Every measurement below carries its date
and method; anything not measured is listed as not measured in section 5.

## What changed since 2026-10-02

Each item was read from the code on 2026-10-20, not from memory.

- **Where the plugin lives (SCRUM-390).** The connector plugins are pnpm
  workspace packages in this repository, `plugins/gws-mcp` and
  `plugins/atlassian-mcp`. They are compiled into the gateway image and
  started from `/app/plugins/<slug>`, each under its own non-root account. A
  Notion plugin is `plugins/notion-mcp`, the same shape. The old question of
  a new public repository is answered (section 1). Three places name the
  plugins one by one and take a Notion entry: the `Dockerfile`, the
  pre-merge gate's path table, and the gateway's service map (section 6).
- **Registry rows (SCRUM-423).** Tool rows ship as a generated file pair in
  `registry/`, run through the `registry` workflow on approval. The
  generator cannot yet add a plugin that is new: it needs the plugin's tool
  file in the base commit's build record, and it writes `tools` rows only,
  never the `mcp_servers` row they hang off (section 6).
- **Metering (SCRUM-419).** `usage_events` gained `resource` and
  `param_names`, filled for `gws_run` only; every other tool records null in
  them. A Notion plugin of dedicated tools meters by tool name, like the nine
  dedicated tools of SCRUM-419 (section 6).
- **Parity and the runner (SCRUM-428).** Matching the built-in connectors is
  the ruling for a connector's gap list. The admin test runner holds a case
  per tool and skips cases that compare two accounts when the roles map to
  one. A Notion plugin needs its cases from its first tool, and a second
  fixture workspace for the two-workspace cases (section 6).
- **The catalog is past 100.** The registry holds 115 rows (gws-mcp 87,
  atlassian-mcp 28, the same count as the gateway's reviewed snapshot in
  `playground/registry-snapshot.ts`; 114 offered, since `gws_run` is
  internal). The meta-tool
  note's trigger has already been crossed without the migration (section 6).
- **Retry-After (SCRUM-364)** landed in gws-mcp, and **SCRUM-363** landed as
  copy and docs, leaving `connected_accounts` unchanged (section 9).

- **Decided on 2026-10-20.** The connection is registered (OAuth, any
  workspace, full capabilities, one connection for both environments until
  stage 0 shows the rate limit is global); the hosted MCP's tool list can be
  measured from a signed-in client; and one Notion login in several
  workspaces is in the first release, so that work moves from stage 3 into
  stage 1 (section 2). Positioning and the registry path for a new plugin
  are still open, and stage 1 is ordered so neither blocks the build.

The recommendation is unchanged: our own plugin on Notion's REST API, with a
proof stage first.

## Ask

Add Notion as the third connector, next to Google Workspace and Atlassian.
The pitch is the one the other connectors make:
fewer, better-shaped tools, several accounts under one login, one bill.

### Success criteria

The request behind this connector was for lower overhead than Notion's own
connector while doing everything it does. "Overhead" was never defined
further, so it is measured as two halves, and both are the acceptance test:

1. **Capability parity** with the content tools of Notion's hosted MCP
   (search, fetch, create and update pages, databases and data sources,
   query rows, views, comments, move, duplicate, trash and restore), plus
   reading the current user and the workspace's people. Notion AI, Notion
   Calendar, memory and skills are out of scope; they are not reachable
   from the REST API. Where a hosted feature has no REST equivalent, the
   gap is named, not hidden.
2. **Lower measured overhead:** the tool list's token cost, and the size of
   a page read and a row query, ours against the hosted server's, by the
   method in section 5.

## Recommendation

Build our own plugin (`notion-mcp`) on Notion's REST API, the way `gws-mcp`
and `atlassian-mcp` plug in. Do not proxy Notion's hosted MCP. Start with a
proof stage that ships nothing, because four facts the design rests on are
not documented by Notion and have to be observed (section 8).

## 1. Shape

Three options were considered.

### (a) Our own plugin on the REST API. Recommended.

A third workspace package, `plugins/notion-mcp`, built into the gateway
image and started by the plugin manager as a child process under its own
account, called with the user's token in `X-User-Token`. This is the model
the other two plugins use since SCRUM-390, and the gateway needs no new
mechanism: `PLUGIN_SERVICE_MAP`, `REFRESH_FN`, the connect routes, the
registry and the classification snapshot each take one more entry. The two
pieces of release plumbing that do not yet extend to a new plugin are in
section 6.

What makes this cheap now and was not true a year ago: since February 2026
the REST API reads and writes page content as markdown
(`GET` and `PATCH /v1/pages/{id}/markdown`, `markdown` on `POST /v1/pages`,
`Notion-Version: 2026-03-11`). The plugin does not have to walk block trees,
convert blocks to markdown, or chunk rich text for page content. That was
the expensive part of every earlier Notion integration.

- Build: one plugin with eleven tools in the first two stages, one pair of
  connect routes, one refresh function, one revoke function, the registry
  and test-runner entries in section 6.
- Run: one more child process in the gateway container, released and rolled
  back with the gateway image. Notion's rate limit is the running cost that
  matters (section 4).
- Keep current: we own it. Notion has shipped three API versions since 2022
  and commits to trying for fourteen days' notice of breaking changes. We
  pin the version header, so a new version breaks nothing until we move.

### (b) Proxy Notion's hosted MCP. Not recommended.

The gateway would become an MCP client of `mcp.notion.com` per user and pass
its tools through.

- It gives up the pitch. The tool list, the descriptions and the response
  shapes would be Notion's, so the overhead would be Notion's too.
- The tool list is not ours to hold steady. Notion's documented list was
  about 35 tools on 2026-10-02; an authenticated client saw 65 on
  2026-10-20, many of them for Notion AI, custom agents, meeting notes and
  Notion Calendar, several needing paid Notion plans. One tool was deprecated on
  2026-09-29. Our registry, write classification and test coverage all
  assume a tool set we review; a proxied one changes under us.
- Auth is a second, different OAuth: dynamic client registration against
  `mcp.notion.com`, eight-hour access tokens, refresh tokens that rotate on
  every use and expire after 30 idle days. Notion's guide says
  non-interactive authorization is not supported yet.
- The hosted server is labelled Beta in its own metadata, read 2026-10-03.

Cost to build is lower than (a) for the tools and higher for the plumbing
(a generic upstream-MCP client with per-user OAuth does not exist in the
gateway). Cost to keep current is the highest of the three, because nothing
tells us when the upstream list changes.

### (c) Hybrid: our plugin, plus the hosted MCP for what REST cannot do.

REST search matches titles only. The hosted MCP's search matches content,
and its AI search reaches connected sources. If title-only search turns out
to fall short of parity in practice, the fallback is to proxy
that one capability and nothing else. It carries all of (b)'s plumbing for
one tool, so it is held back until someone asks for it with a concrete case
(open question 5).

## 2. Auth

### What Notion gives us

Read from Notion's developer docs on 2026-10-02.

- A public connection (Notion's current word for a public integration) with
  a client id and secret. Authorize at
  `https://api.notion.com/v1/oauth/authorize` with `owner=user`; exchange at
  `POST /v1/oauth/token` with HTTP Basic client auth. No scopes parameter and
  no PKCE on this flow.
- The token response carries `access_token`, `refresh_token` (string or
  null), `bot_id`, `workspace_id`, `workspace_name`, `workspace_icon` and
  `owner`. One grant is one user in one workspace.
- During consent the user picks which pages the connection can see. A parent
  page brings its children. They can add pages later from a page's menu
  without going through OAuth again. The connection sees nothing else.
- Capabilities (read, update and insert content; read and insert comments;
  user information with or without email) are set on the connection, not per
  grant. Changing them later makes every user re-authenticate.
- Refresh uses the same token endpoint and returns a new access token and a
  new refresh token. `POST /v1/oauth/revoke` and `/v1/oauth/introspect`
  exist.
- Since 2026-06-08 a new public connection mints a fresh token pair on every
  successful authorization, including a repeat for the same workspace.
- Registration needs no review for OAuth use. Marketplace listing is
  optional and is reviewed.

### How it maps onto the gateway

- Service id `notion`, plugin slug `notion-mcp`, added to
  `PLUGIN_SERVICE_MAP` and `PROVIDERS`.
- `GET /auth/notion/connect` and `/auth/notion/connect/callback` in
  `auth.ts`, copied in shape from the Atlassian pair: session check,
  attribution stash, `next` stash, CSRF nonce in an httpOnly cookie echoed in
  `state`, all three consumed before any return. No consent interstitial:
  Notion has no per-scope opt-out to coach around. `/auth/notion/connect`
  joins `ATTRIBUTED_PATHS`.
- Storage is unchanged: tokens in `service_connections`, identity in
  `connected_accounts`. Neither table enumerates services, so no migration
  for a single workspace.
- Refresh: `refreshNotionToken` in `REFRESH_FN`. It persists the new refresh
  token on every use, as the Atlassian function does. Two things have to be
  right that the Atlassian path gets away without:
  - Notion's token schema has no `expires_in`, and stage 0 saw none
    (section 8). The gateway refreshes only when `token_expires_at` is in
    the past and treats null as never expiring. If Notion access tokens
    expire without saying when, the refresh has to be driven by a 401 from
    the API instead. Which of the two is true is a stage 0 observation, not
    a guess.
  - The existing refresh has no lock, so two concurrent calls can both
    present the same refresh token. With rotation that can end the
    connection. The Notion refresh takes a row lock, the way the OAuth
    server's own refresh does.
- Disconnect: `REVOKE_FN` gets a Notion entry that calls
  `/v1/oauth/revoke`. Whether that also removes the connection from the
  workspace's settings is not documented (stage 0).
- Grant honesty: `scope-grant.ts` already answers "complete" for anything
  that is not Google, which is correct here, since capabilities are fixed at
  registration. The Notion equivalent of a missing scope is a page that was
  not shared. The API answers `object_not_found` for those, and the plugin
  rewrites that into words: the page is not shared with the connection, and
  how to share it. A failed refresh emits an event, so a dead connection
  does not look like a quiet user.
- Errors: Notion's envelope is `{object: "error", status, code, message}`.
  The analytics redaction (`usage/redact.ts`) keeps fields by name and type
  from an allowlist modelled on Google's envelope: `code` only when it is a
  number, `status` only when it is a string. Notion's are the other way
  round, so as the code stands today both would be dropped and only
  `message` kept. Notion's shape gets its own case and its own test.

### Several workspaces

The account identifier in the gateway is an email:
`connected_accounts.account_email` is NOT NULL, unique per user and
connector, and is what the `account` parameter matches. For Notion the email
is the authorizing person's, from the token response's `owner`, which
requires the "user information with email" capability.

- Two Notion logins with different emails: works with no change. Each is a
  connected account, routed by email, like two Google accounts.
- One Notion login in two workspaces: both grants carry the same email and
  collide on the unique key. Left alone, the second connect would overwrite
  the first one's tokens.
- Decided in scope for the first release on 2026-10-20, so the fix ships in
  stage 1: a nullable `external_account_id` (the workspace id) on
  `connected_accounts`, the unique key widened to include it, `label` set to
  the workspace name, `list_connected_accounts` showing the workspace, and
  the `account` parameter accepting a workspace name where an email is
  ambiguous. It touches account routing for every connector, so the other
  two keep a null workspace id and their behaviour is pinned unchanged by
  the default-account suite. SCRUM-363 left the key alone (section 9).

### What has to be registered, and by whom

Registering an OAuth app is the founder's action, not this session's.
Registered on 2026-10-20: one public connection, OAuth, installation scope
"Any workspace", the full capability set below, and two redirect URIs, the
production callback and the local dev callback. The secrets are
`NOTION_OAUTH_CLIENT_ID` and `NOTION_OAUTH_CLIENT_SECRET`. What follows is
the recommendation as written, kept for the reasoning.

- Where: Notion's developer portal, under public connections.
- Two connections, one for production and one for development, so a local
  disconnect can never revoke a production grant. As registered, one
  connection serves both. Revoke is per token, so that risk is small; the
  cost that remains is that if the rate limit is global per connection,
  local testing spends production's budget. One connection stands until
  stage 0 shows the limit is global; if it does, a separate development
  connection is registered.
- Fields: name, logo, redirect URIs (the gateway's
  `/auth/notion/connect/callback` on the production host; the same path on
  the local dev origin for the dev connection), installation scope,
  capabilities.
- Installation scope must be "Any workspace". It cannot be changed after
  creation.
- Capabilities: recommended as the full set for stages 1 and 2 (read, update
  and insert content; read and insert comments; user information with email)
  at creation, because adding one later forces every connected user to
  reconnect. This means the read-only first stage holds a grant that could
  write. The docs page says so. Registered with the full set.
- Two secrets, `NOTION_OAUTH_CLIENT_ID` and `NOTION_OAUTH_CLIENT_SECRET`,
  through all four hops: the config schema, the parameter store, the host
  render, and the production compose file's environment list.
- Registration comes before any code that requests the grant.

## 3. Tool surface

Tool names follow the existing convention: `<service>_<verb>_<noun>`,
snake case, the service as the first token. That token is what the service
icon, the skills connector lookup and the write classifier already key on.
Reads carry no write-verb token; writes do, so the classifier's verb floor
gates them without a special case.

Pinned API version: `2026-03-11`, the latest, and the one the markdown
endpoints require. In this version a database is a container of one or more
data sources, queries and schemas live on the data source, `in_trash`
replaces `archived`, and appends take a `position` object.

### Stage 1: six reads

| Tool | Does | Notion endpoint |
|---|---|---|
| `notion_search` | Find pages and data sources by title. | `POST /v1/search` |
| `notion_get_page` | One page: properties as plain values, content as markdown, a truncated flag, the ids of blocks with no markdown form. | `GET /v1/pages/{id}`, `GET /v1/pages/{id}/markdown` |
| `notion_get_database` | A database, its data sources, each one's property schema. | `GET /v1/databases/{id}`, `GET /v1/data_sources/{id}` |
| `notion_query_data_source` | Rows of a data source with filter, sorts and a property allowlist, as plain values. | `POST /v1/data_sources/{id}/query` |
| `notion_get_comments` | Comments on a page or block. | `GET /v1/comments` |
| `notion_list_users` | People and bots in the workspace, or one by id. | `GET /v1/users`, `GET /v1/users/{id}` |

### Stage 2: five writes

| Tool | Does | Notion endpoint |
|---|---|---|
| `notion_create_page` | A page under a page, or a row in a data source, content as markdown. | `POST /v1/pages` |
| `notion_update_page` | Title and properties; `in_trash` true or false. | `PATCH /v1/pages/{id}` |
| `notion_update_page_content` | Exact-passage replacements, or replace the whole content, in markdown. | `PATCH /v1/pages/{id}/markdown` |
| `notion_move_page` | Move a page to another parent. | `POST /v1/pages/{id}/move` |
| `notion_create_comment` | Comment on a page or reply in a discussion. | `POST /v1/comments` |

There is no delete tool because Notion's API has no hard delete for pages:
`notion_update_page` with `in_trash: true` is the delete, it takes the id
`notion_create_page` returned, and `in_trash: false` is the restore. That
also gives the test runner a restoring pair.

### Added for parity on 2026-10-20

Parity with the hosted server's content tools is the acceptance test
(Success criteria), so these move out of "later" and into stage 2:
`notion_create_database`, `notion_update_data_source`,
`notion_create_view`, `notion_update_view`, `notion_update_comment`,
`notion_delete_comment`, and an imitated duplicate. The parity map below
names each.

### Later, each on a concrete request

A raw block read for the blocks markdown reports as unknown (bookmarks,
embeds, link previews); file uploads and attachments.

### What parity means, stated honestly

Against the six areas in the ask:

- Pages, comments, users: covered by the eleven tools.
- Databases and data sources: read and query in stage 1, rows written in
  stage 2, schema changes later.
- Blocks: covered through markdown, not through block tools. A page's
  content is read and written whole or by passage. Block-level operations
  are not offered, on purpose: block JSON is where the overhead lives.
- Search: **not at parity, and cannot be on REST.** The REST endpoint
  matches titles only, filters only by object type, and Notion documents it
  as not immediate and not guaranteed complete. The hosted MCP searches
  content. This is the largest known gap between the recommended shape and
  the hosted server.

### Parity map against the hosted server (2026-10-20)

The hosted server's tool list was read on 2026-10-20 from an authenticated
client: 65 tools, of which the content tools below are the parity target.
Notion AI, Notion Calendar, memory, skills and the custom-agent tools are
out of scope. Each REST endpoint was read from Notion's API reference for
version `2026-03-11` the same day.

| Hosted tool | REST | Ours |
|---|---|---|
| search | `POST /v1/search`, titles only | `notion_search`; content search is a gap |
| fetch | pages (markdown), databases, data sources, views | `notion_get_page`, `notion_get_database` (with its data sources and views) |
| query-data-sources | filter and sort; saved-view query | `notion_query_data_source`, filter mode and a `view_id` mode; SQL mode is a gap |
| query-multiple-data-sources | none | gap: no SQL, no joins |
| get-comments | `GET /v1/comments`, unresolved only | `notion_get_comments`; resolved comments are a gap |
| get-self, get-users | `GET /v1/users/me`, `GET /v1/users` | `notion_list_users`, with `me` |
| create-pages | `POST /v1/pages`, one per call | `notion_create_page`; a bulk call loops |
| update-page | `PATCH /v1/pages/{id}` and `/markdown` (passage edit, replace, insert), template | `notion_update_page`, `notion_update_page_content` |
| delete-pages, restore-pages | `in_trash` on the page | `notion_update_page` |
| move-pages | `POST /v1/pages/{id}/move`, pages only | `notion_move_page` |
| duplicate-page | none | imitated, read then create; loses comments and some block fidelity, and says so |
| create-database | `POST /v1/databases` | `notion_create_database` |
| update-data-source | `PATCH /v1/data_sources/{id}` | `notion_update_data_source` |
| delete-databases | `in_trash` on the database | `notion_update_data_source` or the database's own `in_trash` |
| create-view, update-view | `/v1/views` | `notion_create_view`, `notion_update_view` |
| create-comment | page, block, reply | `notion_create_comment`; a comment on selected text is a gap |
| update-comment, delete-comment | own comments only | `notion_update_comment`, `notion_delete_comment` |
| set-comment-reaction, set-discussion-resolved | none | gap |

The gaps, in one place: content search, SQL queries and joins, resolved
comments, comments on selected text, reactions, resolving a discussion, and
a native duplicate. Every one is a missing REST endpoint, not a choice. The
hosted server also gates several of its own (AI search, SQL joins, comment
edit, reactions) behind Notion's paid plans.

### What the plugin does that a one-to-one mapping does not

- Properties in and out as plain values. A Notion property is a typed
  envelope; a select is an object with an id, a name and a colour. The plugin
  returns `{"Status": "Done"}` and accepts the same, looking up the data
  source schema to encode a write. That costs one extra API call on a row
  write.
- A property allowlist and a page size on queries, so a wide database does
  not arrive whole.
- Every list tool returns the cursor it accepts. Notion's page size caps at
  100, so a result at the ceiling is reported as truncated, with
  `has_more`, never as the full set.
- The same shape for no results as for some.

### Limits the plugin has to respect

From Notion's request-limits page, read 2026-10-02.

| Limit | Value | Handling |
|---|---|---|
| Requests per connection | 180 per minute; 600 on Notion's Business and Enterprise plans; fixed 60-second window | See section 4 |
| Requests per workspace | Shared across all connections; number not published | Same |
| Rate-limit response | 429 or 529 with `Retry-After` in seconds | A read waits once if the wait is short; a write never retries blind. Otherwise the wait is returned in words. |
| Payload | 500 KB, 1,000 block elements | Large markdown writes use Notion's async option |
| Rich text object | 2,000 characters; 100 objects per array | Property and comment text is chunked by the plugin. Page content goes through markdown and is not chunked by us. |
| Block children append | 100 per request, two levels deep | Not used; content goes through markdown |
| Pagination | 100 per page | Cursor exposed on every list tool |
| Markdown read | Truncates near 20,000 blocks | `truncated` passed through |
| Markdown write | Synced pages cannot be updated | Returned as a worded refusal |

## 4. The rate limit is the risk that could change the shape

Notion's limit is "per connection". The docs do not say whether that means
our integration across every customer, or our integration within one
workspace. If it is the first, every user of the connector shares 180
requests a minute, and the connector stops being a product at a few dozen
active users. Stage 0 measures this with two workspaces before anything is built on it.

**Observed 2026-10-21 03:40 UTC: per workspace, not global.** One grant was
driven with sequential `POST /v1/search` calls: request 181 returned 429
`rate_limited` after 44.5 seconds, with `Retry-After: 16`. In the same window
a grant for a second workspace, same connection and same Notion login, was
served (200), and the first grant was still refused on the next call (the
control). So the 180 a minute belongs to the connection's grant in one
workspace. Not measured: whether two people in the same workspace share
it; the docs' "per workspace" pool suggests they do.

## 5. Overhead, measured

Method. Each server's `tools/list` was fetched over MCP, reduced to what a
client model receives (name, description, input schema), and counted with
Anthropic's token-counting endpoint as tool definitions on
`claude-sonnet-5-5`, subtracting a no-tools baseline of 10 tokens. Bytes are
the JSON of the same list. All four rows were taken on 2026-10-03 between
04:08 and 04:17 UTC with the same script. The count includes the fixed
preamble the API adds whenever any tool is present, so each row overstates
its own list by the same small amount.

| Tool list | Tools | Bytes | Tokens | Tokens per tool |
|---|---|---|---|---|
| Notion's open-source server, npm `@notionhq/notion-mcp-server` 2.5.2, run locally with a placeholder token | 24 | 76,225 | 33,560 | 1,398 |
| Our Google Workspace plugin, local checkout | 68 | 66,588 | 25,745 | 379 |
| Our Atlassian plugin, local checkout | 22 | 8,972 | 3,833 | 174 |
| Proposed Notion surface, draft definitions for all eleven tools | 11 | 6,924 | 2,910 | 265 |
| Proposed Notion surface, the six stage 1 reads only | 6 | 3,839 | 1,733 | 289 |

What these rows are and are not:

- The proposed rows count **draft** definitions written for this document.
  They will change when the tools are built. The gateway also adds an
  `account` parameter and a slug prefix to each tool, which these rows do
  not include.
- The two plugin rows are local checkouts, not what production serves, and
  they are from 2026-10-03. Since then gws-mcp has grown to 87 tools and
  atlassian-mcp to 28 (SCRUM-419, SCRUM-428). These rows were not
  re-measured for this refresh.
- The open-source server is **not** Notion's hosted server. Notion's
  own README says it is no longer actively maintained, and Notion's 2025
  write-up says the hosted server was built because the one-to-one mapping
  cost too many tokens. It is here because it is the only Notion tool list
  that can be read without a Notion login.

Not measured, and why:

- **The hosted server's `tools/list`.** It answers 401 without a token
  (`initialize` against `https://mcp.notion.com/mcp`, 2026-10-03 04:08 UTC).
  Measuring it needs a Notion account to sign in and consent, which this
  session does not have and should not create.
- **A typical page read and a typical database query, through either
  server.** Both need a token and a workspace with real content.
- **Any response-size comparison.** No claim is made here that our reads
  will be smaller than the hosted server's. Notion's hosted server returns
  markdown too. The claim that can be made today is narrower: the proposed
  tool list is 2,910 tokens.

So the comparison that matters, ours against the hosted server,
is open until stage 0. If the hosted list turns out to be close to ours, the
overhead argument shrinks to response shape and the case rests on several
accounts and one bill.

## 6. Gateway work

Every place that had to learn about Atlassian, and so will learn about
Notion.

- **Auth and tokens:** the connect pair in `auth.ts`; `PLUGIN_SERVICE_MAP`,
  `REFRESH_FN`, `REVOKE_FN` in `service-token.ts`; `PROVIDERS` in
  `lib/analytics.ts`; router config in `server.ts`; `ATTRIBUTED_PATHS`.
- **Config:** two keys in the config schema, `.env.example`, both compose
  files, the README's env table, the parameter store.
- **Connect card:** `CONNECTABLE_SERVICES`, `SERVICE_PRESENTATION` (it
  throws at load if a registry id has no row), the service detail route
  (generic), the agent's `request_connection` description and connect copy,
  `SERVICE_NAMES` in the skills catalogue, `SERVICE_ID_BY_CONNECTOR` and the
  prefix regex in `skill-links.ts`.
- **Icon:** `notion` in `KNOWN_SERVICES`, the SVG with its provenance line,
  the server logo entry. Every mention of the company carries its logo.
- **Packaging (SCRUM-390):** `plugins/notion-mcp` as a workspace package.
  The gateway's `Dockerfile` names each plugin explicitly: its
  `package.json` for the frozen install, its compiled `server/`, its
  manifest and README, and a `plugin-notion-mcp` system account (the next
  free id after 901 and 902). A plugin directory with no account is never
  started. `scripts/gate.sh` names each plugin in its path table: a path
  under `plugins/notion-mcp/` matches no row today, falls to `all`, and runs
  the gateway's and the other two plugins' suites but not Notion's own. So
  the gate gains a `notion-mcp` row and surface, with self-test lines like
  the other two. CI's tool-file step (`scripts/image-plugin-tools.sh`) loops
  over every directory under `plugins/`, so `tools-notion-mcp.json` is kept
  beside each image with no change there.
- **Registry rows (SCRUM-423):** tool rows ship as a generated pair in
  `registry/`, `pnpm registry:diff <slug> --from <running sha> --to <new
  sha>`, run through the `registry` workflow on approval, rows before the
  image. Two gaps for a plugin that is new, both in the plumbing rather than
  in Notion:
  - The generator refuses when the base commit's build record holds no tool
    file for the slug, which is true of every first release.
  - It writes `tools` rows joined to an existing `mcp_servers` row, and
    nothing creates that row for a plugin that ships in the image: the
    manager's GitHub install path has no caller, and the manager starts only
    the `active` rows it finds.

  So stage 1 begins by extending the generator and the file check to a new
  plugin (an absent base read as an empty tool set, and one guarded
  `mcp_servers` insert), or by deciding on a one-time reviewed statement for
  the server row. The comparison against the plugin's live `tools/list`
  after the rows run stays.
- **Write classification:** every tool in `REGISTRY_CLASSIFICATION`, every
  read in `KNOWN_READ_TOOLS`, in the commit that ships the tool. The
  live-registry test is red until the rows exist, so the order is plugin,
  rows, gateway.
- **Admin test runner (SCRUM-428):** a case per tool from the first tool,
  or the run reports the tool uncovered and is not green. A `notion` role in
  `ACCOUNT_ROLES` and `PLUGIN_ROLES["notion-mcp"]`; fixture keys for a test
  page and a test data source in `FIXTURE_KEYS` and in the
  `TEST_RUNNER_FIXTURES` shape documented in `.env.example`; a `notion`
  scenario. Write cases are restoring pairs on labelled artifacts. The
  stored-token case covers the third plugin.
  - **A second fixture workspace.** The two-workspace questions (shared rate
    limit, several accounts, a share that one workspace sees and the other
    does not) need a second role, mapped to a second Notion login, and cases
    marked `distinctAccounts`. When both roles map to one account the
    runner skips those cases with the reason; it never runs them on one.
- **Send guard:** it has no Notion rules, and a tool it does not know passes
  unguarded. A Notion comment that mentions a person notifies them. Stage 2
  adds a rule that Notion writes in a test run may target only the fixture
  page and data source, and it is proven by an attempt to write elsewhere
  against the real handler.
- **Metering:** nothing new. A call is one call, stamped `notion` through
  the service map. A plugin missing from the map would meter with a null
  connector and vanish from per-connector views, so the map entry lands with
  the first tool. The `resource` and `param_names` columns (SCRUM-419) are
  filled for `gws_run` alone and stay null for Notion's dedicated tools,
  which is right: the tool name already says what ran. A generic Notion
  call tool is not proposed; if one is ever added, it gets its own field
  extraction the way `gws_run` did.
- **Rate-limit retry:** the plugin takes SCRUM-364's rule from gws-mcp
  (`rate-limit-retry.ts`): retry only a refusal for rate, at most three
  attempts, `Retry-After` read as whole seconds or an HTTP date and nothing
  else, never a gateway or proxy failure. One difference: gws-mcp decides
  "read" by HTTP method, and two Notion reads are POSTs (`/v1/search`,
  `/v1/data_sources/{id}/query`). The Notion plugin decides by the tool's
  read-only annotation instead, so those two retry and no write does.
- **Analytics redaction:** the Notion error case in `usage/redact.ts`
  (section 2).
- **Docs and site:** `CONNECTORS` entry and `content/docs/notion.md`;
  mentions in getting-started and usage; a changelog entry per stage, with
  `connector: "notion"`. At launch: the home page's coming-soon chip, the
  headline and FAQ copy that names connectors, the pricing page, the contact
  page, the comparison component, the agent's system prompt and suggested
  first read, the README and plugin manifest. Copy names services, never a
  tool count.
- **Pricing copy:** no price change is proposed. Notion calls count against
  the same allowance. The pricing page gains the name.
- **Skills:** the codebase map and gateway recipes gain the third connector
  in the commit that adds it.

The catalog trigger. On 2026-10-02 the registry had 91 tools and Notion
would have crossed the "about 100" line in the meta-tool migration note.
That has happened without Notion: the registry holds 115 rows today
(gws-mcp 87, atlassian-mcp 28; 114 offered). Notion's eleven make 126.

What that means for a Notion plugin:
- Notion does not create the decision; it is already due. Drifting past the
  trigger is what the note warned against, and it has happened.
- A user is still served only the tools of the services they connected. The
  list that grows is the one a user with all three connected sees, about
  125, and that user is also the one the multi-service pitch is for.
- The proposed surface is small by design (eleven tools, 2,910 tokens of
  draft definitions in section 5), so Notion adds less to that list than a
  one-to-one mapping would.

Open question 6 is reframed accordingly: not whether Notion crosses the
line, but whether the meta-tool decision is taken before Notion's stage 2
ships to users who connect all three.

## 7. Terms

The review of Notion's developer terms is tracked privately and has to close
before the first production deploy. This document records only
the engineering choices that do not depend on it: OAuth is the only way in,
and the connector never asks for or accepts a pasted integration token; the
published request limits are respected (sections 3 and 4).

## 8. Risks, unknowns, and what would stop this

Observed in stage 0 on 2026-10-21 (UTC), against the registered connection
with two workspaces under one Notion login. Field names and statuses only;
no token was recorded.

1. **Token response.** Fields: `access_token`, `refresh_token`, `bot_id`,
   `workspace_id`, `workspace_name`, `workspace_icon`, `owner`,
   `duplicated_template_id`, `token_type`, `request_id`. No `expires_in`.
   `owner.type` is `user` and carries the person's email. Whether access
   tokens expire at all: a token left unrefreshed is being called every 30
   minutes for 24 hours; result pending.
2. **Refresh rotates both tokens, and the old pair is not dead at once.**
   The old pair stays valid until the new access token is first used.
   Before that, presenting the old refresh token again succeeds, mints a
   further pair, and invalidates the unused one. After the new access token
   has been used, the old refresh token is refused (400 `invalid_grant`,
   "Invalid refresh token") and the old access token answers 401
   `unauthorized`. Consequences: a refresh whose response was lost before it
   was stored can be retried with the stored token; two concurrent refreshes
   still race, so the row lock stays; and one `invalid_grant` is not proof
   of a dead connection until the row has been re-read.
   `POST /v1/oauth/introspect` reports `active: false` for every refresh
   token, working ones included, so it is usable for access tokens only.
3. **Rate limit:** per workspace, not shared across workspaces (section 4).
4. **Revoke:** `POST /v1/oauth/revoke` answers 200 and the token answers 401
   at once; a grant for another workspace is unaffected. Not yet observed:
   whether the connection also leaves the workspace's settings, and what
   the API returns after a user removes it there.
5. **Unshared page:** 404 `object_not_found`, the message naming the
   connection and saying to share the page with it. A page id that does not
   exist returns the identical response, so the plugin's worded refusal has
   to cover both.
6. **Markdown read:** 200 with `markdown`, `truncated` and
   `unknown_block_ids`, as documented; a template page was 1,741 bytes.
7. Still open: re-authorizing the same workspace (whether the earlier pair
   survives, whether `bot_id` changes), and the hosted server's tool list
   size against ours (section 5).

Risks:

- Search parity (section 3).
- Demand is not sized in this document. The home page already lists Notion
  as coming soon.
- Notion's hosted server is free, first-party and moving monthly. Anything
  we claim against it is true on the date it was measured and expires on
  Notion's roadmap.
- Page-level sharing will produce "not found" for pages the user can plainly
  see in Notion. It is the most likely first support question.
- Answered by the code since SCRUM-390: there is no host install. The
  plugin ships in the gateway image. What remains open is how its
  `mcp_servers` row and first tool rows are written (section 6).

What would make us not build this:

- The rate limit is global per integration and Notion will not raise it.
- The hosted server's measured overhead is close to ours, so the
  overhead argument does not exist, and several accounts under one login is
  judged not enough on its own.
- Title-only search turns out to be a blocker and the hybrid is not
  acceptable either.
- The privately tracked terms review says no.

## 9. Overlap with other open work

- SCRUM-363 (identity) has landed as copy and documentation: one account per
  sign-in email, and what to do when an app is on the wrong one. It did not
  change `connected_accounts`: the unique key is still
  `(user_id, connector_type, account_email)`, so section 2's analysis of
  several workspaces stands, and stage 1's task 3a is the only change to that key on
  the table.
- SCRUM-364 (retry on Google rate refusals) has landed in gws-mcp. The
  Notion plugin takes the same rule, keyed on read-only tools rather than on
  HTTP method (section 6).

## 10. Stages

The plan is `docs/plans/2026-10-02-scrum-366-notion-connector.md`.

0. Proof: a dev connection and a test workspace, the six unknowns answered,
   the overhead comparison completed. Ships nothing. Ends in go or no-go.
1. Read-only connector: connect, several workspaces under one login (moved
   here from stage 3 on 2026-10-20), six reads, docs, changelog. Useful
   alone.
2. Writes: five tools, the send-guard rule, launch copy.
3. Folded into stage 1.
4. The later tools, each on a concrete request.

## Open questions

Sent to the founder through the HQ session; listed in the plan.
