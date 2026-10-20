# Notion connector: implementation plan (SCRUM-366)

Date: 2026-10-02, refreshed 2026-10-20 against main at `d85d087`. Design:
`docs/architecture/2026-10-02-scrum-366-notion-connector-design.md`, whose
"What changed since 2026-10-02" section lists what the refresh changed and
why. Status: plan only. No stage has started.

Stage 0 answers questions the later stages depend on, so stages 1 to 3 are
written at task level, with files, tests and gates, and not at code level.
Each gets its code-level task list when the stage before it closes.

Rules that hold in every stage:

- This repo is public, and the plugin lives in it. Rules go in commits,
  never evidence: no customer names, no figures from analytics, no internal
  ids.
- CI runs the gate and the leak scan on every pull request, and main takes
  merges only. A green pull request is not the security gate: the security
  review still runs on the outgoing diff before every push. Every gate below
  names the command or the observation, and a skipped suite is not a passed
  one.
- A guard counts once it has been seen to fail against the thing it guards.
- Test accounts are the company's own, never a work account from elsewhere.
- Registration, secrets, merges, deploys and production data changes are the
  founder's, through HQ.

## Open questions for the founder

Blocking stage 0:

1. **Register a development Notion connection?** A public connection in
   Notion's developer portal with the local callback as redirect URI,
   installation scope "Any workspace" (permanent once chosen), and the
   capabilities in question 2. Plus a throwaway workspace with a few pages
   and one database to test against.
2. **Capabilities: full set at creation, or read-only first?** Recommended:
   the full set (read, update and insert content; read and insert comments;
   user information with email), because adding one later forces every
   connected user to reconnect. The cost is that the read-only stage holds a
   grant that could write, which the docs would state.
3. **Sign in to Notion's hosted MCP once, in the test workspace, so its tool
   list and a page read and a query through it can be measured?** Without
   this the overhead comparison against the hosted server stays open.
4. **Terms review.** Tracked privately; it has to close before the
   production connection is registered.

Blocking a later stage, not stage 0:

5. **Is title-only search acceptable for the first release?** REST search
   matches titles only; the hosted server searches content. If content
   search is needed, the fallback is the hybrid in the design, which is
   a larger build.
6. **The meta-tool trigger is already crossed** (115 registry rows today;
   126 after Notion's stage 2). Notion does not create the decision, but it
   grows the list a user with all three services sees to about 125.
   Recommended: decide the migration on its own ticket, before Notion's
   stage 2 ships.
7. **Does the first release need one Notion login in several workspaces?**
   Different Notion logins work from stage 1. The same login in two
   workspaces needs the schema change in stage 3; until then the second
   connect is refused with words.
8. ~~A new public repo for the plugin?~~ Answered by SCRUM-390: a workspace
   package, `plugins/notion-mcp`, the same shape as the other two.

## Stage 0: proof. Ships nothing.

Needs: questions 1 to 3 answered, and the dev connection's client id and
secret in the local environment only.

Tasks, each ending in a dated observation written into the design doc's
section 8:

1. Complete the OAuth flow by hand against the dev connection. Record the
   token response's field names (never its values): is there an expiry, is
   there a refresh token, what `owner` contains with and without the email
   capability.
2. Refresh once. Then present the old refresh token again. Record whether it
   is dead, and what error comes back.
3. Authorize the same workspace a second time. Record whether the first
   pair still works and whether `bot_id` changed.
4. Leave an access token unused past any stated or suspected lifetime, then
   call the API. Record what an expired token looks like.
5. Rate limit: with two workspaces connected to the same dev connection,
   drive one to a 429 and call the other in the same window. Record whether
   the second is limited. This is the go or no-go observation. Keep the
   volume to what one 429 needs.
6. Revoke through the API. Record whether the connection disappears from the
   workspace's settings. Separately, remove the connection in Notion's
   settings and record what the API then returns.
7. Call a page that was not shared. Record the error code and body shape.
8. Measure, with the same token-count method as the design's section 5: the
   hosted server's `tools/list`; one named test page read through the hosted
   server and through `GET /v1/pages/{id}/markdown`; one named database
   query through both. Record bytes, tokens, date, and the page's block
   count and the database's row and property counts.
9. ~~Confirm with the operator how a third plugin is installed on the host.~~
   Answered by the code: there is no host install since SCRUM-390. The
   plugin ships in the gateway image. What replaces this item is a decision
   for HQ, recorded before stage 1: how the plugin's `mcp_servers` row and
   first `tools` rows are written, by extending `registry:diff` and
   `registry-file-check` to a new plugin, or by one reviewed statement
   (design section 6).

Gate: the design doc's unknowns are replaced by observations, the overhead
table has its missing rows, and the founder says go or no-go. Nothing
merges.

## Stage 1: read-only connector. Useful alone.

What a user gets: connect a Notion workspace from the dashboard, then
search, read pages as markdown, read database schemas, query rows, read
comments and list people, from any MCP client and from the dashboard agent,
with several Notion logins under one account.

Order matters and is fixed: provider registration, secrets, plugin, registry
rows, gateway, checks, docs.

1. **Production connection registered** by the founder; both secrets in the
   parameter store; the two keys in the config schema, `.env.example`, both
   compose files and the README table. Rebuild the config package before
   trusting a local test of a new key. Verify on the host that the running
   container has both.
2. **Workspace package `plugins/notion-mcp`**, laid out like
   `plugins/atlassian-mcp`: `/health` and `/mcp`, `X-User-Token` read per
   session, one tool array and one handler switch, the shared response
   helpers. The gateway `Dockerfile` gains its explicit entries (package
   manifest, compiled server, plugin manifest and README, and the
   `plugin-notion-mcp` account). `scripts/gate.sh` gains a `notion-mcp`
   row and surface with self-test lines; without them a Notion path falls
   to `all`, which runs every suite except Notion's.
   - A Notion client with the pinned version header, the worded
     not-shared error, and SCRUM-364's rate-limit rule from gws-mcp, keyed
     on the tool's read-only annotation rather than on HTTP method, because
     search and data-source queries are POSTs.
   - Property decoding to plain values, one function per property type, with
     a test per type built from recorded responses.
   - The six read tools. Every list tool returns and accepts a cursor; a
     full page is reported with `has_more`.
   - Tests: a fake client cannot show a missing response, so each tool also
     has one recorded-response test, and the stage ends with a live run
     against the test workspace.
3. **Gateway: auth.** The connect pair, `PLUGIN_SERVICE_MAP`, `PROVIDERS`,
   `ATTRIBUTED_PATHS`, `refreshNotionToken` with a row lock and persisted
   rotation, the Notion entry in `REVOKE_FN`, the refusal of a second
   workspace under the same email. Whether refresh is driven by expiry or by
   a 401 follows stage 0.
   - Tests: the CSRF and callback-ordering suites gain the Notion routes;
     a concurrent-refresh test on real Postgres that fails without the lock;
     a test that the second-workspace connect leaves the first grant's
     tokens untouched.
4. **Gateway: surfaces.** `CONNECTABLE_SERVICES` and its presentation row,
   the icon and its provenance, the server logo, the agent's connection
   copy, the skills service names and connector lookup, the docs connector
   entry, the Notion error case in redaction with its test.
5. **Registry rows (SCRUM-423).** First, the path for a new plugin decided
   in stage 0's item 9: either `registry:diff` and `registry-file-check`
   extended to a new plugin (an absent base as an empty set, one guarded
   `mcp_servers` insert), with their own tests, or a reviewed one-time
   statement. Then the pair is generated after merge, from the running sha
   to the merge sha, and HQ runs it through the `registry` workflow on
   approval, rows before the image. After the deploy, compare the rows field
   by field with the plugin's live `tools/list`, and run the registry
   ground-truth test by hand against the real plugin and the real registry;
   it skips silently without both.
6. **Classification.** Six entries in `REGISTRY_CLASSIFICATION`, six in
   `KNOWN_READ_TOOLS`, in the gateway commit that follows the rows.
7. **Admin test runner (SCRUM-428).** The `notion` role in `ACCOUNT_ROLES`
   and `PLUGIN_ROLES`, the page and data source fixture keys (in
   `FIXTURE_KEYS` and the `.env.example` shape), a `notion` scenario, six
   cases, the stored-token case extended. A second role mapped to a second
   fixture workspace, for the cases marked `distinctAccounts`. HQ sets the
   values in `TEST_RUNNER_FIXTURES`. The run must show no uncovered Notion
   tool, and no two-workspace case skipped for want of the second workspace.
8. **Docs and changelog.** `content/docs/notion.md`, including how page
   sharing works and what "not found" means; the changelog entry. Only tools
   that are implemented, registered and callable are named. No launch copy
   yet.
9. **Skills.** The codebase map and the gateway recipes describe the third
   connector, in the same commit as the code.

Gate: suite, typecheck and build pass; the security review passes; after
deploy, a real client connects a real workspace and each of the six tools
returns real content; the admin test run is green; the changelog entry is
live.

## Stage 2: writes

1. Five write tools in the plugin: property encoding from plain values
   against the data source schema, rich-text chunking for property and
   comment text, markdown content through Notion's endpoints, the async
   option for large writes. No blind retry of a failed create.
2. Registry rows through the SCRUM-423 pair (five inserts, generated after
   merge) and classification for the five. Their names carry write verbs, so
   the classifier gates them with no special case; the snapshot records them
   as writes.
3. Send guard: Notion writes in a test run may target only the fixture page
   and data source. Proven by an attempt to write elsewhere through the real
   handler, with the real argument shape.
4. Test cases as restoring pairs on labelled artifacts: create then trash,
   update then restore, comment on the fixture page only. Assert on the
   trashed state, not on a read returning empty.
5. Docs, changelog, and the launch copy sweep: the home page chip and
   headline, FAQ, pricing, contact, comparison, agent prompt and suggested
   read, README and manifest. Copy names services, not counts.
6. Any published skill that uses Notion, with the catalogue's accuracy tests.

Gate: as stage 1, plus the send-guard proof and a clean fixture after the
run.

## Stage 3: several workspaces under one Notion login

Scheduled only if question 7 says it is needed, and coordinated with
SCRUM-363, which reads the same key.

1. Migration: nullable `external_account_id` on `connected_accounts`, the
   unique key widened to include it. Migration before code.
2. `upsertServiceAccount`, token resolution and default selection take the
   workspace into account for Notion and are unchanged for the other two,
   pinned by the existing default-account suite on real Postgres.
3. `list_connected_accounts` shows the workspace; the `account` parameter
   accepts a workspace name where the email is ambiguous, and an ambiguous
   value is refused with the choices, never guessed.
4. The second-workspace refusal from stage 1 is removed.

## Stage 4: later tools

Create and update databases and data sources, raw block read, file uploads,
views, comment edit and delete. Each is added on a concrete request, with
its registry row, classification, test case and docs line, in that order.

## Not in this plan

The hybrid that proxies Notion's hosted search; a marketplace listing;
webhooks; any change to pricing or the allowance.
