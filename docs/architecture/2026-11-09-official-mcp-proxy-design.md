# A layer on top of official MCP servers, Slack first (official-mcp-proxy)

Status: design, not built. Nothing here is built until a build go.

## Ask

Where a vendor runs an official MCP server, the gateway sits in front of it. It passes the vendor's
tools through and adds our layer: one login, the user's own connection, usage tracking, and read or
write marking. Slack is the first upstream. Every connector so far is our own plugin on the
vendor's REST API, and the Slack design (`2026-11-01-scrum-454-slack-connector-design.md`,
section 1(b)) chose a plugin over this layer. That choice is reversed here.

### Success criteria

- A user connects Slack once at the gateway and calls Slack's hosted tools through `/mcp` with no
  Slack login of their own in the client.
- Every passed-through call writes one `usage_events` row, attributed to the user, the service, the
  account and the tool, exactly as a plugin call does. Pinned by a test.
- No upstream tool is ever listed or callable before a person has classified it, and no new
  upstream tool can appear as a read.
- A scheduled check reports, per upstream, whether it answers and whether its tool list changed.

## Recommendation

1. Declare each upstream in code, on its connector record (`upstream: { url, auth, ... }`), with
   an `mcp_servers` row for the registry joins and no plugin process.
2. Snapshot the upstream's tools into our `tools` table through the existing registry pair, and
   run a scheduled check every six hours that compares the live list with the snapshot and records
   a health result per upstream.
3. Proxy a call by opening a client to the upstream URL with the user's token as
   `Authorization: Bearer`, through the same CallTool dispatch a plugin call takes, so metering,
   argument validation, the scope pre-check and the 401 handling are unchanged.
4. Stage 1 is Slack, one admin user, reads only. Writes wait for a gateway-side target check.
5. Retire `slack-mcp` unshipped. It was never connected, and its connect and refresh code carries
   over.

## 1(b) revisited: the reasons the proxy was rejected

The Slack design gave three reasons. Each is answered or accepted here:

- **"The gateway has no remote-MCP proxy today."** True, and it is small. The gateway is already an
  MCP client over streamable HTTP to its own plugins (`callPluginToolOnce` in `user-tools.ts`). A
  plugin call differs from an upstream call in three places: the URL, the header the token rides
  in, and who stamps the failure. Section 7 covers the third.
- **"We would not control the tool names, descriptions, response sizes or the write guard."** Names
  and descriptions: we serve the reviewed snapshot, not the live list, so a vendor change reaches a
  user only after review (section 3). Response sizes: not shaped. The 900 KB cap our plugins apply
  lives in the plugins, not the gateway, so the upstream adapter applies the same cap itself. Beyond
  that, a large answer is passed through. This is accepted. The write guard is
  covered in section 5; it is given up for stage 1 by shipping reads only.
- **"Rate limits are the same as the Web API's."** Still true; Slack's page says so. The proxy saves
  no budget and costs none. Accepted.

## 1. Shape

An upstream is declared on its connector record in `connectors/registry.ts`, the one list every
connector fact already derives from:

```ts
upstream?: {
  url: string;              // "https://mcp.slack.com/mcp"
  auth: "oauth-confidential" | "oauth-discovery" | "bearer-pasted";
  // Query parameters the vendor reads to trim its list (PostHog's features=,
  // readonly=). Empty for Slack.
  params?: Record<string, string>;
};
```

What stays as it is:

- **`pluginSlug`** stays the tool prefix and the `mcp_servers` slug. Slack keeps `slack-mcp`, so
  the vendor's `slack_send_message` is served as `slack-mcp__slack_send_message`, and
  `PLUGIN_SERVICE_MAP`, the scope rules and the runner roles need no rename.
- **`audience`** is the record's existing field. Slack keeps `admin`.
- **The `mcp_servers` row** holds the slug and status, and is the foreign key for `tools`. It is
  inserted by the registry pair, as a new plugin's row is today (`--new-plugin`).

What changes:

- **The plugin manager skips a row whose connector declares an upstream.** Today it marks a missing
  plugin directory as `down`. `/health` then reports the upstream from the scheduled check
  (section 3) instead of from a child process.
- **`buildPluginServerUrl`** returns the upstream URL, with its params, for such a row.
- **`registry.test.ts`**, which checks the connector list against `plugins/` on disk, accepts a
  record with an upstream and no directory.

Why code and not a table: the URL and the auth shape decide where a user's token is sent. That is a
reviewed code change, not a row anyone with registry write access can edit.

## 2. Auth per user

Tokens are stored as they are today: sealed in `service_connections`, one `connected_accounts` row
per account, refreshed under the existing lock, and revoked on disconnect under the SCRUM-180 rule.
The only new part is the header: an upstream call sends `Authorization: Bearer <token>` where a
plugin call sends `X-User-Token`.

### Confidential OAuth with a registered app (Slack)

From Slack's own page:

- **Endpoints:** authorize at `https://slack.com/oauth/v2_user/authorize`, exchange at
  `https://slack.com/api/oauth.v2.user.access`.
- **Client auth:** the app's client id and secret, sent as `client_secret_post`. PKCE S256 is
  supported.
- **No dynamic registration:** the app is created by hand.
- **Accepted apps:** "Only apps published in the Slack Marketplace and internal apps can use MCP at
  this time; unlisted apps are prohibited from using MCP." An internal app is what the company
  workspace needs.

This is the shared connect flow (`ConnectorOAuth`) Slack already has. The connector's `oauth.ts`
moves from `oauth/v2/authorize` and `oauth.v2.access` to the `v2_user` pair, and `identify` reads
the team from the new answer. The pin in `auth-connect-contract.test.ts` changes with it.

**Token rotation.** It is optional for MCP: Slack's own sample manifest sets it off. With it on, an
access token lasts 12 hours and each refresh token works once, which `refreshSlackToken` already
handles under the rotating lock. It cannot be turned off once on. The recommendation is on: a
leaked token dies in 12 hours, and the refresh code exists and is tested. This is Manuel's call,
because it cannot be undone.

### OAuth with discovery (PostHog)

PostHog's hosted server documents OAuth as the recommended path. Its live metadata has a
registration endpoint, and names `oauth.posthog.com` as the authorization server. Our PostHog
connect uses a client metadata document against one regional host instead, because the central
server keys a user's region on the client id (SCRUM-471). Whether `mcp.posthog.com` accepts a token
from the regional flow is not known and is the first thing a PostHog stage measures. Not in scope
here (section 11).

### A token the user pastes (Brevo)

Brevo's MCP page documents a bearer token only: an "MCP token" created under API keys. That needs a
connect surface we do not have: a form that takes the token, checks it with one `tools/list`, and
stores it sealed as the access token, with no refresh and no provider revoke. Not in scope here
(section 11).

## 3. Tool list: our registry, with a scheduled check

The registry and its drift tooling exist for our plugins: rows in `tools`, a reviewed
classification, and `pnpm registry:diff`, which writes a guarded forward and rollback pair that the
`registry` workflow runs. For an upstream, the difference is where the tool file comes from. A
plugin's tool file is written by CI when it builds the image. An upstream's can only be read with a
user's token, because Slack refuses even `initialize` without one (measured: 401 on `initialize`
and `tools/list` with no token, 2026-11-09).

### What extends

- **`tools` rows** for an upstream are written by the same registry pair, from a snapshot instead of
  an image tool file. `registry-diff.mjs` gains a source: `--from-snapshot <file>`, the stored
  result of a scheduled check (below).
- **Classification** is the existing reviewed record (`REGISTRY_CLASSIFICATION`) and the name
  classifier, which treats any name it does not know as a write (section 4).
- **`tools.enabled`** is the trim. A row that exists but is disabled is neither listed nor callable,
  so we can register the vendor's whole list and serve the part we chose.

### What is new: the scheduled check

- **Where:** in the gateway process, on the node-cron the other jobs use, every six hours and on
  demand from an admin route.
- **As whom:** each upstream names a probe connection: the connection of the runner's account for
  that service (the `slack` role). The check uses that token and nothing else.
- **What it does:** `initialize`, then `tools/list`, against the upstream URL.
- **What it compares,** per tool, against the registry rows:
  - the name;
  - the description;
  - the input schema, by the md5 of its Postgres jsonb text, as `registry-diff` already computes it;
  - the annotations, by `readOnlyHint` and `destructiveHint`.
- **What it records:** one row per run in a new table, `upstream_checks`:

  | column | |
  |---|---|
  | `upstream` | the slug |
  | `checked_at` | |
  | `reachable` | the TCP and TLS connection and an HTTP answer |
  | `initialized` | `initialize` answered |
  | `listed` | `tools/list` answered |
  | `latency_ms` | |
  | `tool_count` | |
  | `snapshot` | jsonb: the list as received, the input to `--from-snapshot` |
  | `drift` | jsonb: `added`, `removed`, `changed` (by field) |
  | `error` | a fixed code, never a body |

### What a detected change does

- **A new tool** is held as unreviewed. It has no `tools` row, so it is not listed, and the
  dispatch refuses a call to an upstream tool with no enabled row. It reaches users after a person
  classifies it and the registry pair adds it.
- **A changed description, schema or annotation** is flagged. Users keep the reviewed text and
  schema until the pair updates the row. If the vendor added a required argument, calls fail
  upstream with the vendor's own error, and section 7 covers how that reads.
- **A removed tool** is withdrawn at once: listing and dispatch skip an upstream tool missing from
  the latest successful check. The `tools` row stays until a registry pair removes it. So the check
  changes what is served without writing to the registry, which stays the workflow's alone.

**Who is told:** a check with drift, or one that fails twice in a row, posts one line to the
alerts channel (`SLACK_CHANNEL_ALERTS`, through `sendSlack`). The row is there for anyone to read.

**Health:** `/health` and the runner read the latest `upstream_checks` row per upstream: reachable,
initialized, listed. The connections page can show "Slack is not answering" from the same row.

### What a user sees the same day

| Vendor change | Same day, for a user |
|---|---|
| Adds a tool | Nothing. It appears after review. |
| Renames a tool | The old name is withdrawn at the next check (within six hours). Until then a call to it gets the vendor's unknown-tool error, unmetered (section 7). The new name appears after review. |
| Removes a tool | Withdrawn at the next check. Before that, the same unknown-tool error. |
| Changes a description | Nothing; the reviewed text stays. |
| Adds a required argument | Calls fail with the vendor's validation error until the row is updated. |

### Size of the list

- **Ours, measured:** `slack-mcp`'s ten tools are 11,650 bytes as compact JSON (name, description,
  input schema), about 2,900 tokens at bytes over four, the method the Notion design used.
- **Slack's hosted list: not measured.** It needs a token, and the app does not exist yet. Slack's
  page lists 20 features in its rate-limit table, and Anthropic's connector listing shows 11 tool
  names. The first step of stage 1 is one authenticated `tools/list`, measured the same way, before
  any row is written. The Notion hosted server came out at about 65,000 tokens for 65 tools, so the
  trim is not optional until the number is known.

## 4. Read or write marking

- **We classify; we do not trust the vendor.** Each upstream tool gets a reviewed entry in
  `REGISTRY_CLASSIFICATION`, and every read also needs its name in `KNOWN_READ_TOOLS`. The name
  classifier treats any name it does not know as a write, so the playground gate asks first.
- **Annotations:** the vendor's annotations are recorded in the snapshot. The `read_only_hint` and
  `destructive_hint` served to clients come from our review, written by the registry pair, as for
  our own plugins.
- **No unclassified read:** a new upstream tool has no row until review, so it cannot be listed at
  all, let alone as a read. The classification test's fail-closed check covers upstream rows as it
  covers plugin rows.

## 5. Guards we lose

`slack-mcp` refuses a post unless the model named the target: `expected_channel_name` or
`expected_user_email`, resolved and compared before sending. Slack's hosted `slack_send_message`
has no such argument, and we cannot change its schema at the vendor.

- **Keepable, at a cost.** The gateway can add a required `expected_channel_name` argument to the
  served schema, resolve the target with one Slack Web API call using the same user token
  (`conversations.info`), compare, strip the argument, and only then forward. That is a per-tool
  pre-check hook in the dispatch, plus a Web API dependency in the gateway for one vendor.
- **For stage 1 it is given up, because stage 1 ships no writes.** Writes do not ship without either
  the pre-check hook or Manuel saying in words that the guard is given up.
- **Also lost:** response trimming. `slack-mcp` shaped its answers; the hosted server's answers
  pass through as they are, capped at 900 KB by the adapter.

## 6. Usage tracking

A passed-through call goes through the CallTool dispatch in `mcp-server.ts`, the same path a plugin
call takes. So it inherits:

- the allowance check;
- `resolveServiceToken`, and the account it resolved;
- argument validation against the registry row;
- the scope pre-check (with a Slack tool-to-scope table from Slack's page);
- `trackToolCall`.

That last one writes one `usage_events` row with `connector_type: slack`, the namespaced tool name
and the account email. No new metering code.

**The test (the success criterion):** a dispatch test against a local fake upstream (an MCP server
that checks for `Authorization: Bearer <token>`) asserts:

- exactly one `trackToolCall` with the service, tool and account;
- the bearer reached the upstream;
- `X-User-Token` did not.

A second test asserts an upstream failure on our side is not metered.

## 7. Failure modes

A plugin stamps its own failures (`_meta["datatorag.com/error"]`) and the gateway meters on them. A
vendor stamps nothing, so its errors would read as the user's own and be metered. The upstream
adapter stamps what it sees at the transport, and leaves the vendor's tool-level errors as they are.

| Case | What the adapter sees | Client sees | Metered |
|---|---|---|---|
| Upstream down | connect fails | "Slack's MCP server did not answer. Try again in a moment." | no (`unreachable`) |
| Slow | no answer in 30 s | the same, saying it timed out | no (`transient`) |
| Rate-limited | HTTP 429, `Retry-After` | "Slack is rate-limiting these calls; try again in N seconds." | no (`http` 429) |
| Token revoked or expired | HTTP 401 | the SCRUM-180 path: one forced refresh, then "needs reconnecting" with the connect link, and the row marked | no |
| Tool removed mid-session | JSON-RPC unknown-tool error | "This Slack tool is no longer offered." It is withdrawn at the next check. | no (`unknown_tool`) |
| Vendor tool error (bad channel, missing scope) | a result with `isError` | the vendor's own words | yes, as today for a provider 4xx |

Slack's format for a revoked token on the MCP server is not documented. The table assumes the
standard MCP behaviour of a 401 at the transport; stage 1 verifies it by revoking the probe token
once.

**Sessions.** Each call opens a client, initializes, calls and closes, as `callPluginToolOnce`
does. Against a remote server that is one extra round trip per call. Stage 1 accepts it and measures
it; a per-user client pool is a later change if the number says so.

## 8. Test runner

- **The existing SL cases** call `slack-mcp`'s own tool names. They are retired with the plugin.
- **New read cases** are written against the hosted names, one per enabled read.
- **The send guard** (`tests/send-guard.ts`) refuses any `slack_` tool it has no rule for. That
  stays true, and is what keeps a hosted write from being called by a case before its rule exists.
- **A probe case** runs the scheduled check once and asserts reachable, initialized and listed, and
  no drift against the registry. A vendor change then fails the daily run as well as posting.

## 9. Slack: what the app needs

Verified on Slack's pages (the MCP server page, its developing page, the manifest reference and the
OAuth page):

- **An internal app** in the company workspace, public distribution off.
- **MCP on:** "Agents" in the app's sidebar, then "Slack Model Context Protocol (MCP) Server" on.
  Its manifest key is `settings.is_mcp_enabled`.
- **Redirect URL:** HTTPS, and the URL sent must match or sit under one configured. Ours is
  `https://datatorag.com/auth/slack/connect/callback`, the shared flow's callback for
  `/auth/slack/connect`.
- **User scopes:** the full set Slack's server supports, requested once, because adding a scope
  later makes every connected user reconnect. Tools are then enabled selectively in our registry.
- **No bot scopes and no bot user.**
- **Token rotation:** see section 2. The manifest below has it on.

The manifest Manuel pastes (Slack, "Create New App", "From a manifest"):

```yaml
display_information:
  name: DataToRAG
  description: DataToRAG's connection to this workspace's Slack MCP server.
oauth_config:
  redirect_urls:
    - https://datatorag.com/auth/slack/connect/callback
  scopes:
    user:
      - canvases:read
      - canvases:write
      - channels:history
      - channels:read
      - channels:write
      - chat:write
      - emoji:read
      - files:read
      - files:write
      - groups:history
      - groups:read
      - groups:write
      - im:history
      - im:read
      - im:write
      - lists:read
      - lists:write
      - mpim:history
      - mpim:read
      - mpim:write
      - reactions:read
      - reactions:write
      - search:read.files
      - search:read.im
      - search:read.mpim
      - search:read.private
      - search:read.public
      - search:read.users
      - users:read
      - users:read.email
settings:
  is_mcp_enabled: true
  token_rotation_enabled: true
  org_deploy_enabled: false
  socket_mode_enabled: false
```

The scope list is the server's own `scopes_supported` from `mcp.slack.com`'s live metadata, the
same 30 scopes as Slack's tool-to-scope table. After creating the app: install it to the workspace
once, then hand the client id and secret to HQ for the parameter store (`SLACK_CONNECTOR_*`, the
names that exist).

## 10. What happens to the built plugin

| Option | Cost |
|---|---|
| **Retire `slack-mcp` unshipped. Recommended.** | Lose the target guard and trimmed answers (section 5); the plugin's tools and SL cases go. Nothing a user had: it was never connected. The connect flow, refresh and revoke stay and are adapted. One Slack surface, one set of names. |
| Keep it behind the admin flag as a fallback | Two Slack surfaces with different tool names for the same thing, two runner suites, two sets of classification entries, and a plugin process for a service the layer serves. A fallback is only useful if we would switch to it, and switching means users relearn names. |
| Keep only the tools the hosted server lacks | Editing a message (`slack_message_update`) and listing files by channel (`slack_files_list`) have no hosted equivalent in Slack's table. Keeping them means a plugin process and a second token path for two tools. Worth it only on a concrete request. |

Retiring keeps the code in history, so the third option stays open later.

## 11. PostHog and Brevo, for Manuel to rule

**PostHog.** The hosted server (`https://mcp.posthog.com/mcp`) documents OAuth and a personal key,
routes US and EU itself, and trims with `features=`, `tools=` and `readonly=true`. Its docs say it
has hundreds of tools; the categories on its tools page add up to about 1,200. A `mode=cli` setting
replaces them all with one `exec` tool.

- **What moving it would take:**
  - a new connect against `oauth.posthog.com` with dynamic registration, because whether our
    regional token is accepted is unknown;
  - a snapshot of a `features=`-trimmed, read-only list;
  - classification of every enabled tool;
  - about the size of the Slack stage once the layer exists.
- **What is lost:** the one-project pin (our plugin refuses a session whose project is not the
  granted one, and hosted tools take a project argument), the placeholder-only HogQL in our ten
  reads, and our fixed ten-tool surface.

**Brevo.** The hosted server (`https://mcp.brevo.com/v1/brevo/mcp`, or one URL per module of 27)
documents a bearer "MCP token" only, made under API keys.

- **What moving it would take:**
  - the paste-a-token connect surface (new UI, a check call, sealed storage with no refresh);
  - one module URL per enabled area;
  - classification of each tool.
- **What is lost:**
  - one-click OAuth, replaced by a pasted key;
  - revocation on disconnect, since we cannot revoke a key the user made; deleting it is theirs to
    do in Brevo;
  - annotations, which Brevo's page does not mention.

Its rate limits are not published.

Both stay as built until Manuel rules.

## 12. Stages

Each stage proves one new thing.

0. **The app (Manuel, about 15 minutes):** create the internal app from the manifest, install it
   once, hand the client id and secret to HQ.
1. **One upstream, one user, reads only.** The connector's `upstream` field; the plugin manager
   skip; the upstream URL and bearer in the dispatch; the transport failure stamping and the
   900 KB cap in the adapter; the connect moved to `v2_user`.
   - **Before any row:** one authenticated `tools/list`, measured (section 3).
   - **Registry:** a registry pair for the reads chosen, classified.
   - **Tests:** the usage test, read cases in the runner.
   - **Proves:** a proxied call is authenticated, metered and attributed.
2. **The scheduled check.** `upstream_checks`, the six-hour job, the drift comparison, runtime
   withdrawal of a removed tool, the post to the ops channel, `/health`, the probe case,
   `registry-diff --from-snapshot`. Proves a vendor change is seen within six hours without a
   registry write.
3. **Writes.** The target pre-check hook, or Manuel's words that the guard is given up; send-guard
   rules for each hosted write; write cases. Proves writes are as safe as the plugin's were, or says
   they are not.
4. **A second upstream,** when Manuel rules on PostHog or Brevo. Proves the layer is general, and
   for Brevo, the paste connect.

## Verified, and not

**Verified on the vendor's own page:**
- Slack:
  - the server URL and transport;
  - confidential OAuth with the `v2_user` endpoints, and no dynamic registration;
  - internal and Marketplace apps only;
  - the MCP toggle and its manifest key;
  - the manifest keys for user scopes, redirect URLs and rotation;
  - the tool-to-scope table;
  - rotation's 12 hours and one-use refresh;
  - rate limits equal to the Web API's.
- PostHog: the URL, OAuth or a personal key, `features=`, `readonly`, `mode`, and the rate limits.
- Brevo: the URLs and the bearer MCP token.

**Measured live (2026-11-09):**
- Slack's server answers 401 to `initialize` and `tools/list` without a token.
- Its OAuth metadata lists the 30 scopes, `client_secret_post` and S256.

**Not verified:**
- Slack's full tool names, descriptions and schemas, and so the list's size. Only two names are on
  Slack's page; eleven are on Anthropic's connector listing.
- Slack's error format for a revoked MCP token.
- Whether a `v2_user` token without rotation ever expires on the MCP server.
- PostHog's EU URL and its annotations.
- Brevo's tool count, annotations and rate limits.

## Decisions for Manuel

1. Token rotation on (recommended) or off, knowing on cannot be undone.
2. The full 30 user scopes at registration (recommended), or only the reads now and a reconnect for
   every user later.
3. Retire `slack-mcp` (recommended), keep it as a fallback, or keep two tools.
4. For writes: build the target pre-check, or accept in words that the guard is given up.
5. PostHog and Brevo: move either onto the layer, or leave them as built.
