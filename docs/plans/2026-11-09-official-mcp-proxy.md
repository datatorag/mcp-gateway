# Official MCP proxy layer, Slack first: plan

Design: `docs/architecture/2026-11-09-official-mcp-proxy-design.md`. Nothing here starts until a
build go, and stage 1 cannot start before stage 0 is done.

## Global constraints

- **One dispatch:** a passed-through call goes through the CallTool dispatch in `mcp-server.ts`. No
  second dispatch path, no second metering path.
- **Tokens:** sealed in `service_connections`, opened only in `service-token.ts`. An upstream token
  is sent only to its connector's declared `upstream.url`.
- **Classification:** no upstream tool is listed or callable without an enabled `tools` row and a
  reviewed classification. An unknown name is a write.
- **Registry writes:** only through the registry pair and its workflow. The scheduled check never
  writes `tools`.
- **Public repo:** fixtures use example.com and fake tokens, and no em or en dashes.

## Stage 0: the Slack app (Manuel)

1. Create the internal app in the company workspace from the manifest in design section 9.
2. Install it to the workspace once.
3. Hand the client id and secret to HQ for the parameter store under the existing
   `SLACK_CONNECTOR_CLIENT_ID` and `SLACK_CONNECTOR_CLIENT_SECRET`. `SLACK_CONNECTOR_TEAM_ID` stays.

Done when: the connect from a local gateway reaches Slack's consent screen for the app.

## Stage 1: one upstream, one user, reads only

### Task 1.1: measure the hosted list

- **Files:** none in the repo. A scratch script, kept out of it.
- **Steps:**
  1. Connect the admin account on a local gateway after task 1.3.
  2. Run one authenticated `tools/list` against `https://mcp.slack.com/mcp`.
  3. Record the tool count, the names, the compact-JSON bytes of name, description and input
     schema, and bytes over four.
- **Done when:** the report carries the numbers. They decide which reads are enabled.

### Task 1.2: declare the upstream

- **Files:**
  - `apps/gateway/src/gateway/connectors/registry.ts`: `upstream?: { url; auth; params? }` on
    `ConnectorRecord`, set for `slack`.
  - `apps/gateway/src/gateway/connectors/registry.test.ts`: a record with `upstream` needs no
    `plugins/<slug>` directory.
  - `apps/gateway/src/gateway/plugin-manager.ts`: `startAll` skips a row whose connector declares an
    upstream, without marking it `down`.
  - `apps/gateway/src/gateway/user-tools.ts`: `buildPluginServerUrl` returns the upstream URL with
    its params.
- **Tests:**
  - an upstream row is not spawned;
  - its URL is the declared one;
  - a record without `upstream` resolves as today.

### Task 1.3: the connect on Slack's `v2_user` endpoints

- **Files:**
  - `apps/gateway/src/gateway/connectors/slack/oauth.ts`: authorize at
    `https://slack.com/oauth/v2_user/authorize`, exchange at
    `https://slack.com/api/oauth.v2.user.access` (`client_secret_post`, PKCE S256), the full scope
    list, and `identify` reading the new answer.
  - `apps/gateway/src/gateway/connectors/slack/tokens.ts`: the refresh against the same token
    endpoint.
- **Tests:**
  - `auth-connect-contract.test.ts`, the Slack row: the new URLs and a recorded answer of the new
    shape;
  - the refresh pin for rotation.
- **Rule:** the pin changes in this commit, and the PR names the change. The callback keeps its
  refusals: `ok: false`, `is_enterprise_install`, and any team but `SLACK_CONNECTOR_TEAM_ID`, each
  still asserted by the pin.

### Task 1.4: the upstream adapter

- **Files:**
  - `apps/gateway/src/gateway/upstream-call.ts` (new): `callUpstreamTool({ url, token, toolName,
    args, clientName })`. It opens a client with `Authorization: Bearer`, initializes, calls,
    closes, and applies a 30 s deadline and the 900 KB cap. It turns transport outcomes into
    `_meta["datatorag.com/error"]`:
    - unreachable → `unreachable`;
    - deadline → `transient`;
    - HTTP 429 → `http` 429;
    - HTTP 401 → `http` 401;
    - unknown tool → `unknown_tool`.
  - `apps/gateway/src/gateway/mcp-server.ts`: the dispatch calls it for an upstream server where it
    calls `callPluginToolOnce` for a plugin. A call to an upstream tool with no enabled row is
    refused before any request.
- **Tests (`upstream-call.test.ts`, against a local fake MCP server):**
  - the bearer reaches the upstream, and no plugin-only header does: not `X-User-Token`, not any
    `pluginContextHeaders` header;
  - each failure maps to its kind;
  - an answer over 900 KB is cut with a marker;
  - the deadline holds.

### Task 1.5: usage, the success criterion

- **Files:** `apps/gateway/src/gateway/mcp-server.upstream.test.ts` (new).
- **Test:** a call to `slack-mcp__<a hosted read>` through the real dispatch, with the fake
  upstream:
  - one `trackToolCall` with `connectorType: "slack"`, the namespaced tool and the resolved account;
  - `classifyOutcome` meters a success;
  - it does not meter an `unreachable`, a 429 or an unknown tool;
  - a 401 takes the SCRUM-180 forced refresh.
- **Failing control:** with the dispatch routed around `trackToolCall`, the test fails.

### Task 1.6: the registry rows for the reads

- **Files:**
  - `registry/2026-11-xx-official-mcp-proxy-slack.sql` and its rollback, generated by
    `registry-diff --new-plugin --from-snapshot <task 1.1 list>`;
  - `apps/gateway/src/gateway/playground/registry-snapshot.ts`: each enabled read, as read;
  - `KNOWN_READ_TOOLS`: the same names;
  - `scope-grant` or the Slack scope map: the tool-to-scope table from Slack's page.
- **Rule:** reads only enabled; every other hosted tool has a disabled row or none.
- **Review:** each vendor description is read as text a model will act on, for instructions aimed at
  the model, not only compared for change. The same holds for every later pair from a snapshot.
- **Depends on** task 2.4 for `--from-snapshot`. Until then the pair is generated from the task 1.1
  list with the same code path, written as a one-off input file.

### Task 1.7: retire `slack-mcp`

- **Files:**
  - remove `plugins/slack-mcp`, its `Dockerfile` lines and account, and its row in
    `scripts/gate.sh`;
  - remove the SL1 to SL10 cases and the plugin-specific send-guard rules;
  - keep `checkSlack`'s refusal of any unknown `slack_` write.
- **Registry:** the plugin's tool rows are replaced by the pair in 1.6 (same slug).

### Task 1.8: runner read cases

- **Files:** `apps/gateway/src/gateway/tests/cases/sl*-*.ts`, one per enabled hosted read, against
  the fixture channel.
- **Done when:** the daily run passes them against a local gateway with the admin's connection.

**Stage 1 is done when:**
- the admin connects Slack and calls each enabled read from a real MCP client;
- each call writes one usage row;
- the runner's read cases pass;
- the measured list size is in the report.

## Stage 2: the scheduled check

### Task 2.1: the table

- **Files:** `packages/db/src/schema/upstream-checks.ts`, and a drizzle migration with its journal
  row.
- **Columns:** design section 3.
- **Who runs it:** HQ runs the migration on production before the deploy.

### Task 2.2: the check

- **Files:**
  - `apps/gateway/src/gateway/upstream-check.ts` (new):
    - opens the probe connection's token;
    - runs `initialize` and `tools/list`;
    - compares names, descriptions, schema md5 and annotations with the enabled and disabled rows;
    - writes one `upstream_checks` row.
  - `apps/gateway/server.ts`: node-cron every six hours, and a route to run it now behind the same
    admin check as the other admin routes, so no one else can make it spend the probe token.
- **Tests:**
  - added, removed and changed are each detected;
  - a 401 records `listed: false` with a fixed code;
  - the check never writes `tools`.

### Task 2.3: withdrawal and health

- **Files:** `user-tools.ts` listing and the dispatch skip an upstream tool missing from the latest
  successful check; `/health` reports each upstream from its latest row.
- **Alert:** drift, or two failures in a row, post one line to `SLACK_CHANNEL_ALERTS`.

### Task 2.4: `registry-diff --from-snapshot`

- **Files:** `scripts/registry-diff.mjs` and its self-test. It reads a snapshot file exported from
  an `upstream_checks` row in place of an image tool file. The guards and the file check are
  unchanged.

### Task 2.5: the probe case

- **Files:** a runner case that runs the check and asserts reachable, initialized, listed and no
  drift.

**Stage 2 is done when:** a tool renamed in the fake upstream is withdrawn at the next check, the
alerts channel gets one line, and a registry pair from the snapshot passes the file check.

## Stage 3: writes

Ruled 2026-11-09: no gateway-side target check. The guard `slack-mcp` had (a post refused unless
the model named its channel or person) is given up for passed-through tools. What remains is the
client's confirmation before a write.

- Each hosted write gets a reviewed `write` entry in the classification record, so it is served
  with `readOnlyHint: false`.
- A send-guard rule per hosted write in `tests/send-guard.ts`, so the runner reaches only the
  fixture channel and the test user's own DM.
- One write case per enabled write.
- The writes enabled by a registry pair from the latest snapshot.

## Stage 4: a second upstream

PostHog or Brevo, on Manuel's ruling. Brevo adds the paste-a-token connect. Its own plan.

## Review focus

1. **A vendor answer that is not MCP** (an HTML error page from a proxy in front of the vendor):
   the adapter reports `unreachable`, never the HTML.
2. **A token for one upstream** is never sent to another URL, including when params are appended
   to the declared URL.
3. **A tool the latest check did not list** is refused even if its row is enabled, and the refusal
   is not metered.
4. **The scheduled check running while a registry pair is applied:** it compares against what it
   read, and a half-applied state shows as drift once, not as a crash.
5. **A user with Slack connected before stage 1** (none exist today; the plugin was never connected):
   the retirement drops nothing a user had.
