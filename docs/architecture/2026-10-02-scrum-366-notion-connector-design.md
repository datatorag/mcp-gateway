# Notion connector (SCRUM-366)

Date: 2026-10-02. Status: design only. Nothing here is built. Every
measurement below carries its date and method; anything not measured is
listed as not measured in section 5.

## Ask

Add Notion as the third connector, next to Google Workspace and Atlassian.
Requested by a customer. The pitch is the one the other connectors make:
fewer, better-shaped tools, several accounts under one login, one bill.

## Recommendation

Build our own plugin (`notion-mcp`) on Notion's REST API, the way `gws-mcp`
and `atlassian-mcp` plug in. Do not proxy Notion's hosted MCP. Start with a
proof stage that ships nothing, because four facts the design rests on are
not documented by Notion and have to be observed (section 8).

## 1. Shape

Three options were considered.

### (a) Our own plugin on the REST API. Recommended.

A third plugin repo, run as a child process, called with the user's token in
`X-User-Token`. This is the existing model and needs no new mechanism in the
gateway: `PLUGIN_SERVICE_MAP`, `REFRESH_FN`, the connect routes, the registry
and the classification snapshot each take one more entry.

What makes this cheap now and was not true a year ago: since February 2026
the REST API reads and writes page content as markdown
(`GET` and `PATCH /v1/pages/{id}/markdown`, `markdown` on `POST /v1/pages`,
`Notion-Version: 2026-03-11`). The plugin does not have to walk block trees,
convert blocks to markdown, or chunk rich text for page content. That was
the expensive part of every earlier Notion integration.

- Build: one plugin with eleven tools in the first two stages, one pair of
  connect routes, one refresh function, one revoke function, the registry
  and test-runner entries in section 6.
- Run: one more child process. Notion's rate limit is the running cost that
  matters (section 4).
- Keep current: we own it. Notion has shipped three API versions since 2022
  and commits to trying for fourteen days' notice of breaking changes. We
  pin the version header, so a new version breaks nothing until we move.

### (b) Proxy Notion's hosted MCP. Not recommended.

The gateway would become an MCP client of `mcp.notion.com` per user and pass
its tools through.

- It gives up the pitch. The tool list, the descriptions and the response
  shapes would be Notion's, so the overhead would be Notion's too.
- The tool list is not ours to hold steady. Notion's documented list is
  about 35 tools, a third of them for Notion AI, custom agents and meeting
  notes, which need paid Notion plans. One tool was deprecated on
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
  - Notion's token schema has no `expires_in`. The gateway refreshes only
    when `token_expires_at` is in the past and treats null as never
    expiring. If Notion access tokens expire without saying when, the
    refresh has to be driven by a 401 from the API instead. Which of the two
    is true is a stage 0 observation, not a guess.
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
  the first one's tokens. The first release refuses the second connect with
  words rather than overwrite a working grant.
- Lifting that limit is its own stage (stage 3): a nullable
  `external_account_id` (the workspace id) on `connected_accounts`, the
  unique key widened to include it, `label` set to the workspace name,
  `list_connected_accounts` showing the workspace, and the `account`
  parameter accepting a workspace name where an email is ambiguous. It is
  held back because it touches account routing for every connector, and
  because the identity work in SCRUM-363 reads the same key (section 9).

### What has to be registered, and by whom

Registering an OAuth app is the founder's action, not this session's.

- Where: Notion's developer portal, under public connections.
- Two connections, one for production and one for development, so a local
  disconnect can never revoke a production grant.
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
  write. The docs page says so. Open question 2.
- Two secrets per environment, `NOTION_CLIENT_ID` and `NOTION_CLIENT_SECRET`,
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

### Later, each on a concrete request

Create and update databases and data sources; a raw block read for the
blocks markdown reports as unknown (bookmarks, embeds, link previews);
file uploads and attachments; views; editing and deleting comments.

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
active users. Notion's terms also require staying within rate limits. Stage
0 measures this with two workspaces before anything is built on it.

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
- The two plugin rows are local checkouts, not what production serves. The
  Atlassian checkout lists 22 tools; the gateway's registry snapshot has 23.
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
- **Registry rows:** one `mcp_servers` row and one `tools` row per tool,
  written as an explicit step. A plugin deploy does not write them, and
  matching names do not prove matching schemas or descriptions, so the step
  ends with a comparison against the plugin's live `tools/list`.
- **Write classification:** every tool in `REGISTRY_CLASSIFICATION`, every
  read in `KNOWN_READ_TOOLS`, in the commit that ships the tool. The
  live-registry test is red until the rows exist, so the order is plugin,
  rows, gateway.
- **Admin test runner:** a `notion` account role and `PLUGIN_ROLES` entry;
  fixtures for a test page and a test data source; a `notion` scenario; one
  case per tool, or the run reports the tool uncovered and is not green.
  Write cases are restoring pairs on labelled artifacts. The stored-token
  case covers the third plugin.
- **Send guard:** it has no Notion rules, and a tool it does not know passes
  unguarded. A Notion comment that mentions a person notifies them. Stage 2
  adds a rule that Notion writes in a test run may target only the fixture
  page and data source, and it is proven by an attempt to write elsewhere
  against the real handler.
- **Metering:** nothing new. A call is one call, stamped `notion` through
  the service map. A plugin missing from the map would meter with a null
  connector and vanish from per-connector views, so the map entry lands with
  the first tool.
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

The catalog trigger. The registry has 91 tools. Eleven more is 102, past the
"about 100" line in the meta-tool migration note. A user is only ever served
the tools of the services they connected, so no user's list grows unless
they connect Notion, but the note's trigger is written on the catalog. This
is a decision to make on purpose, not to drift past (open question 6).

## 7. Constraints from Notion's Developer Terms

Read in a browser on 2026-10-03; the page says last updated April 2, 2026.
The engineering constraints the connector is built to:

- OAuth is the only way in. The connector never asks for or accepts a
  pasted integration token.
- Stay within the published rate limits (section 4).
- No use of workspace content to train models.
- Our terms and privacy policy describe what the integration reads, writes
  and stores.
- Marketplace listing is optional and may involve a security review.

The terms review itself is tracked privately.

## 8. Risks, unknowns, and what would stop this

Unknown until observed in stage 0:

1. Whether REST access tokens expire, and how we learn that they have.
2. Whether a used refresh token is dead immediately, and whether
   re-authorizing a workspace kills the previous pair.
3. Whether the rate limit is shared across all our users.
4. What revoke does on Notion's side, and what the API returns after a user
   removes the connection.
5. The hosted server's tool list size, and the size of a page read and a
   database query through it and through REST markdown.
6. Whether registration asks for anything the docs do not list.

Risks:

- Search parity (section 3).
- Demand is not sized in this document. The home page already lists Notion
  as coming soon.
- Notion's hosted server is free, first-party and moving monthly. Anything
  we claim against it is true on the date it was measured and expires on
  Notion's roadmap.
- Page-level sharing will produce "not found" for pages the user can plainly
  see in Notion. It is the most likely first support question.
- A first-time install of a third plugin on the host is an operator
  procedure with no caller in the gateway; the operator confirms it before
  stage 1 is scheduled.

What would make us not build this:

- The rate limit is global per integration and Notion will not raise it.
- The hosted server's measured overhead is close to ours, so the
  overhead argument does not exist, and several accounts under one login is
  judged not enough on its own.
- Title-only search turns out to be a blocker and the hybrid is not
  acceptable either.
- The privately tracked terms review says no.

## 9. Overlap with other open work

- SCRUM-363 (identity split) proposes a check on
  `connected_accounts.account_email` in each connect callback, and an index
  on `(connector_type, account_email)`. The Notion callback is a third
  callback that would need the same check, and stage 3 here changes the
  unique key that work reads. Neither branch was touched. Whichever lands
  second adapts.
- SCRUM-364 (retry on Google 429s, in the Google plugin) settles how a
  plugin treats `Retry-After`. The Notion plugin should take the same rule
  rather than a second one.

## 10. Stages

The plan is `docs/plans/2026-10-02-scrum-366-notion-connector.md`.

0. Proof: a dev connection and a test workspace, the six unknowns answered,
   the overhead comparison completed. Ships nothing. Ends in go or no-go.
1. Read-only connector: connect, six reads, docs, changelog. Useful alone.
2. Writes: five tools, the send-guard rule, launch copy.
3. Several workspaces under one Notion login.
4. The later tools, each on a concrete request.

## Open questions

Sent to the founder through the HQ session; listed in the plan.
