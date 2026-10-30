# Connect from inside the chat: implementation plan (SCRUM-466)

> **For agentic workers:** implement task by task; steps use checkbox (`- [ ]`) syntax.

**Goal:** a user in Claude.ai, Claude Code, ChatGPT or Gemini can see what is connected and
connect Google, Atlassian or Notion from a link in the conversation, without finding the
dashboard.

**Architecture:** a hashed single-use connect link in a new `connect_links` table fronts the
three existing `/auth/<provider>/connect` flows. A `connect` built-in and one not-connected
result shape hand the link out; URL-mode elicitation sends it where the client supports it;
instructions, `list_changed`, the 401 sentence and two events finish it.

**Tech stack:** Express routes in `apps/gateway/src/gateway/`, drizzle schema in `packages/db`,
MCP SDK 1.29.0, vitest (mocks; real Postgres via `test-utils/db.ts` for the claim).

**Spec:** `docs/architecture/2026-10-30-scrum-466-connect-from-chat-design.md`. The plan
assumes the recommended answer to each ruling question; a different ruling changes the task
named beside it.

## Global constraints

- `/mcp` keeps its 401 status and `WWW-Authenticate` header byte for byte; no anonymous tool.
- No token, token hash or email in any event, log line or URL other than the link itself.
- Zero em-dashes or en-dashes in any string or doc; a test asserts it for every new string.
- The agent surface's behaviour is unchanged (no `connect`, no instructions, today's error
  text).
- Schema changes through `pnpm --filter @datatorag-mcp/db db:generate`, never hand-written SQL.
- Public repo: "per SCRUM-466" in comments, no HQ ids or numbers.

## Review focus

1. A link opened in a browser signed in as another user: refused, token unspent (Task 3).
2. A link opened with no session, provider email different from the sign-in email: nothing
   stored in either table, no session minted (Task 3).
3. A link fetched by an unfurler: GET spends nothing (Task 3).
4. The scheduler still pauses a skill on every not-connected reason after the text changes
   (Task 4).
5. An elicitation accepted and never completed: the call returns within the wait, with a fresh
   link, never hangs (Task 7).

---

### Task 1: `connect_links` table and store (Ruling 1)

**Files:**
- Create: `packages/db/src/schema/connect-links.ts`, export from `schema/index.ts`; generated
  migration under `packages/db/drizzle/`
- Create: `apps/gateway/src/gateway/connect-links.ts`
- Test: `apps/gateway/src/gateway/connect-links.test.ts` (real Postgres)

**Interfaces (produces):**
- `issueConnectLink(db, { userId, provider, path, clientName }): Promise<{ id: string; url: string }>`:
  32 random bytes base64url, stores `hashToken(token)`, 10-minute expiry, returns
  `${GATEWAY_BASE_URL}/connect/${token}`; emits `connect_link_issued` (Task 8 wires the event).
- `peekConnectLink(db, token): Promise<ConnectLink | null>`: live and unspent, no write.
- `claimConnectLink(db, token): Promise<ConnectLink | null>`: the guarded `UPDATE ... RETURNING`.
- `dropConnectLinksForUser(db, userId)`, `sweepConnectLinks(db)` (rows expired over a day).
- `type ConnectLink = { id; userId; provider; path; clientName; expiresAt }`.

- [ ] Write failing tests: issue stores a 64-hex hash and never the token; claim succeeds once;
  second claim, expired and unknown all return null; peek does not spend; sweep and drop.
- [ ] Schema, `db:generate`, store module; tests green.
- [ ] Call `dropConnectLinksForUser` beside each `dropLinksForUser` call (sign-out, grant revoke,
  disconnect); register the sweep on the existing rollup cron.
- [ ] Commit.

### Task 2: `createWebSession`

**Files:** Modify `apps/gateway/src/gateway/auth.ts` (the inline mint in `/auth/google/callback`);
Create `apps/gateway/src/lib/create-web-session.ts`; Test beside it.

**Interfaces (produces):** `createWebSession(db, res, userId): Promise<void>`: the same row
(`clientId: "web"`, 24 h, hashed) and the same cookie attributes as today.

- [ ] Test: the row and the cookie match what the Google callback wrote before (assert fields).
- [ ] Move the code; the Google callback calls it; existing auth tests unchanged and green.
- [ ] Commit.

### Task 3: the link page and the identity rule (Ruling 2)

**Files:**
- Create: `apps/gateway/src/gateway/connect-link-route.ts` (GET/POST `/connect/:token`,
  GET `/connect/done`), mounted in `server.ts` before the Next catch-all
- Create: `apps/gateway/src/gateway/connect-link-page.ts` (self-contained HTML, in the shape of
  `connect-interstitial.ts`; Google reuses its content)
- Modify: `auth.ts`: the three start routes and callbacks accept `dtr_connect_link` as identity
  when there is no session; the callback's identity check and the "Sign in to continue" page
- Modify: `auth-callback-ordering.test.ts`
- Test: `connect-link-route.test.ts`, `connect-link-identity.test.ts`

**Interfaces:**
- Consumes: Task 1 (`peekConnectLink`, `claimConnectLink`), Task 2 (`createWebSession`),
  `maskEmail`, `liveWebSessionUserId`, the logout POST's cross-site check.
- Produces: `connectLinkUserId(req, db): Promise<string | null>` (the cookie's link, live);
  `takeConnectLink(req, res)` (clears the cookie, returns its link id) for the callbacks;
  the in-process completion emitter `onConnectCompleted(linkId, fn)` /
  `emitConnectCompleted(linkId)` used by Task 7.

- [ ] Failing tests, one per row of the spec's identity rules: same-user session goes on;
  other-user session refused with the token unspent; no session plus equal email completes and
  mints a session; no session plus different email writes neither `service_connections` nor
  `connected_accounts` and mints nothing; GET spends nothing; second POST shows the expired page;
  cross-site POST refused; only the masked email is in any response.
- [ ] Route, page, the start-route and callback changes; the cookie cleared first in each
  callback (ordering test extended).
- [ ] The connect-done page; a link-started connect's `next` is `/connect/done?service=<id>`.
- [ ] Commit.

### Task 4: `notConnectedResult` (Ruling 3)

**Files:** Create `apps/gateway/src/gateway/not-connected.ts`; Modify `mcp-server.ts` (the four
refusal points, plus the plugin `_meta` reconnect case), `connectionFailureService`,
`usage/classify.ts`; Test `not-connected.test.ts`, extend `mcp-server` dispatch tests.

**Interfaces:**
- Consumes: Task 1 `issueConnectLink`.
- Produces: `notConnectedResult({ service, reason, sentence, link }): CallToolResult`, with
  `structuredContent: { error: "not_connected", reason, provider, next: "connect", connect_url }`.

- [ ] Failing tests per reason: text is the sentence, then `Connect it here: <link>`, then the
  dashboard URL; structured content as above; `connectionFailureService` returns the service for
  every reason; `trackToolCall` called with `user_error` and not metered; agent surface text
  identical to today's.
- [ ] Helper, the dispatch changes, the classifier's unmetered rule for these failures.
- [ ] Commit.

### Task 5: the `connect` built-in

**Files:** Modify `mcp-server.ts` (`BUILT_IN_TOOLS` entry, the new `surfaces` field checked where
`attended` is); Test in `mcp-server.builtins.test.ts` and a new `connect-tool.test.ts`.

**Interfaces:** Consumes Task 1, `listConnectedAccounts`, `launchedServiceIds`.

- [ ] Failing tests: all connected gives the one sentence and issues no link; one missing gives
  one link; `service` given issues a link even when connected; absent on the agent surface and
  when `unattended`; unlaunched providers left out; `readOnlyHint` true; unmetered.
- [ ] Entry and the `surfaces` filter.
- [ ] Commit.

### Task 6: instructions, `list_changed`, capabilities

**Files:** Modify `mcp-server.ts` (`instructions`, `tools: { listChanged: true }`),
`server.ts` (a user index on the session map, a `notifyToolsChanged(userId)` export),
`mcp-analytics.ts` (`elicitation_form`, `elicitation_url` on `mcp_session_initialized` and the
start log line); the connect callbacks call `notifyToolsChanged`. Tests beside each.

- [ ] Failing tests: instructions in initialize on the MCP surface, absent on the agent's,
  Notion left out when unlaunched; `list_changed` reaches each of the user's sessions and no one
  else's; capability booleans from `{ elicitation: { url: {} } }`, `{ elicitation: {} }` (form
  only) and none.
- [ ] Implement; commit.

### Task 7: URL-mode elicitation (Ruling 4)

**Files:** Create `apps/gateway/src/gateway/connect-elicitation.ts`; Modify `mcp-server.ts`
(the refusal points and `connect` call it when the capability is present); Test
`connect-elicitation.test.ts` with an in-memory client declaring `elicitation.url`.

**Interfaces:**
- Consumes: Task 1, Task 3's emitter, Task 4.
- Produces: `elicitConnect(server, { userId, service, clientName, extra }): Promise<"connected" | "declined" | "timed_out">`.
  10-minute request timeout; after `accept`, waits on the emitter or a 5-second re-read of the
  connection state, up to 5 minutes; progress every 20 seconds when a progress token was given;
  sends the completion notification when connected.

- [ ] Failing tests (fake timers): accept then complete retries the original call once and
  returns its result; a second failure is returned, not retried; accept without completion
  returns the structured error with a fresh link after the wait; decline returns it at once;
  `elicitation: {}` sends no request.
- [ ] Implement; commit.

### Task 8: the 401 sentence and the events

**Files:** Modify `server.ts` `send401`; `lib/analytics.ts` (`CONNECT_LINK_ISSUED`,
`CONNECT_COMPLETED`); `track.ts` (two capture functions, never throw); the callbacks emit
`connect_completed` with the link's `path`, or `website` when there was no link. Tests beside
each.

- [ ] Failing tests: `message` in both 401 forms; header and other fields unchanged; both events
  carry `provider`, `path`, `client_name` and nothing else beyond the standard keys, no email.
- [ ] Implement; commit.

### Task 9: docs, skills, gate

- [ ] `codebase-map` (the link, the table, the `surfaces` field, instructions),
  `gateway-dev` (the not-connected helper is the one way to refuse for a missing connection),
  `services-integrations` (the two events); the connect section of
  `content/docs/getting-started.md`.
- [ ] `content-marketer` for the changelog entry; copy shown to HQ for Manuel's sign-off.
- [ ] `scripts/gate.sh origin/main`, `pnpm build`, the leak scan, `merge-base`, the
  security-reviewer on the diff with the link reviewed as a credential; PR; no merge, no deploy.
- [ ] After HQ deploys: one session from each of the four clients; report what each advertised
  (`elicitation_url`), and verify the elicitation wait survives the edge for 5 minutes, or
  write it down as an expected failure with -32042 as the fallback.
