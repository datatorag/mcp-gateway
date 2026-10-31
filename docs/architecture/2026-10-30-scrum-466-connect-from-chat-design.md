# Connect Google, Atlassian and Notion from inside the chat (SCRUM-466)

Status: built, to the rulings at the end. Written from the code at `98e952e6`; where the build
differs from the text above the rulings, "As built" says so.

The bet: a user lives in their agent's UI (Claude.ai, Claude Code, ChatGPT, Gemini) and should
be able to connect a provider without going looking for our dashboard. Six pieces, in build
order: a `connect` tool, one not-connected error shape, server instructions, URL-mode
elicitation where the client supports it, one sentence in the 401 body, and two events.

## What does not change

- `/mcp` answers every anonymous call with 401 and the OAuth challenge, as today. The four
  clients start OAuth on that 401 when the server is added; a 200 with a public tool would stop
  that prompt from appearing. No tool runs anonymously, before or after this change.
- The three provider connect flows (`/auth/<provider>/connect` and their callbacks in
  `auth.ts`) keep their order, their CSRF nonce, their duplicate-account branch and their
  destinations. This spec adds a way in, not a new flow.
- The dashboard agent keeps `request_connection` and its in-thread card. Nothing below is
  offered on the agent surface.

## What the code does today

### The connect flows

All three live in `gateway/auth.ts` and share one shape: a start route that needs a live
`dtrmcp_session` (`liveWebSessionUserId`), a 16-byte nonce in an httpOnly cookie echoed as
`state`, a callback that clears every one-shot cookie before any early return
(`auth-callback-ordering.test.ts`), the identity of the provider account, the duplicate check
(`connectedElsewhere`), `upsertServiceAccount`, `trackOAuthCompleted`, and a redirect through
`postConnectDestination`. Without a session both legs redirect to `/auth/login` with no `next`,
so the way back is lost.

Where they diverge:

| | Google | Atlassian | Notion |
|---|---|---|---|
| Before consent | the interstitial (`renderConnectInterstitial`) unless `proceed=1`; `retry`/`refused` and the hint cookie | none | the launch gate (`isServiceLaunched`) |
| After the exchange | the zero-grant refusal | none | the workspace id is required |
| Account identity | userinfo email | `/me` email | owner email plus workspace id and name |

None of the divergences sits before the start route reads the session. **One entry point can
front all three**: it only has to establish who the user is and then hand over to the
provider's own start route, which then runs exactly as it does from the dashboard.

### Sessions

`dtrmcp_session` is an opaque random token whose hash is a row in `oauth_access_tokens`
(`clientId: "web"`, 24 hours), minted inline in `/auth/google/callback`. There is no function
that mints one for a user id, and no signing secret anywhere in the config: the download links
and run ids sign with a per-process random key, and provider tokens are sealed with
`CONNECTION_TOKEN_KEYS`, which is an encryption key, not a signing key.

### Not connected

The gateway refuses before a plugin is reached, at four points in the CallTool dispatch of
`mcp-server.ts`: no token (also what an expired token with no refresh, or a seal that will not
open, looks like), no account matching `account`, a refresh the provider refused, and a missing
Google scope. Each returns a plain-text `isError` result pointing at
`/dashboard/connections/<service>`. The scheduler's `connectionFailureService` recognises three
of those sentences by regex and reads the service from that URL. The first three refusals call
no `trackToolCall`, so a not-connected failure is invisible to usage and analytics today. The
plugins' own no-token messages are unreachable, because the gateway refuses first.

ListTools already hides a provider's tools until it is connected. So a model in a fresh session
never sees a Gmail tool it cannot use; it meets a not-connected error only through a stale tool
list, a wrong `account`, or a connection that broke. That is why the `connect` tool and the
instructions carry most of this story, and the error shape is the fallback.

### MCP surface

The server is built with `capabilities: { tools: {}, prompts: {} }`, no `instructions`, and no
`listChanged`. Initialize capabilities are not read, logged or tracked anywhere: only
`clientInfo` and the protocol version are. The installed SDK (1.29.0, protocol 2025-11-25) has
everything this needs: `ServerOptions.instructions`, `getClientCapabilities()`,
`elicitInput({ mode: "url", ... })`, `createElicitationCompletionNotifier`, and
`UrlElicitationRequiredError` (-32042). `elicitInput` in URL mode throws unless the client
declared `elicitation.url`; a bare `elicitation: {}` means form only. Server-to-client requests
time out after 60 seconds unless the call passes its own timeout.

## 1. The connect link

### Shape

A connect link is `<base>/connect/<token>`, where `<token>` is 32 random bytes in base64url.
It is a credential and is built the way the bearer is: the server keeps only its SHA-256 hash.

New table `connect_links`:

| Column | |
|---|---|
| `id` | uuid |
| `token_hash` | text, unique |
| `user_id` | the DataToRAG user it was issued to, `on delete cascade` |
| `provider` | `google-workspace`, `atlassian` or `notion` |
| `path` | `tool_result` or `elicitation` (what issued it, for the events) |
| `client_name` | the MCP client's name, cleaned and capped as the auth-failure fields are |
| `expires_at` | issue time plus 10 minutes |
| `spent_at` | null until used |

Single use is a claim: `UPDATE connect_links SET spent_at = now() WHERE token_hash = $1 AND
spent_at IS NULL AND expires_at > now() RETURNING ...`. It survives a deploy and is safe with
more than one process. A sweep deletes rows a day after they expire. A user's links are
deleted on sign-out, on OAuth grant revoke and on disconnect, beside `dropLinksForUser`.

**No signing secret, so nothing new in the parameter store.** The brief asked for a signed
link with its secret in SSM. A signature adds nothing to a random token whose hash is looked
up, the way every bearer and web session is checked today. And single use needs a server-side
record anyway, so the record carries the user, the provider and the expiry. It also keeps this
work clear of SCRUM-465's compose wiring. If HQ still wants an HMAC, the token becomes
`<nonce>.<tag>` under a new `CONNECT_LINK_KEY` (SSM, the host render, the compose environment
list, `docker exec printenv`), and the table stays for single use. **Ruling 1.**

### The page

`GET /connect/<token>` spends nothing: chat clients and link unfurlers fetch URLs on their own,
which is why the download link's GET is a page, not the download. It looks the token up
without claiming it and renders one of:

- **Valid:** one sentence naming the provider and the DataToRAG account it will be attached
  to, by its masked sign-in email (`j•••@example.com`, `maskEmail`), and one button. For
  Google this page is the existing interstitial's content, so the user meets the "tick every
  box" guidance once and not twice.
- **Expired, spent or unknown:** one sentence, "This link has expired. Ask your assistant to
  connect again.", and no button. The three are not told apart.
- **The browser is signed in as a different DataToRAG user:** refused, see below.

The button is a POST to the same path, with the same cross-site protection as the logout POST.
The POST claims the token, then hands over to the provider's start route with
`proceed=1` (Google) and a `next` of the connect-done page (below).

### Who the user is, and the attack this has to stop

The brief asks for the link to sign the browser in as the link's user, so nobody is asked to
log in again. Taken literally, that opens a hole. An attacker calls `connect` from their own
account, gets a link, and sends it to a victim. The victim opens it in a browser with no
session, gets signed in as the attacker, connects their own Google account, and the attacker
can now read the victim's mail through their own DataToRAG account. Today that cannot happen,
because a connect needs the attacker's session in the victim's browser and only a Google
sign-in mints one.

So the link proves who the user is only where something else agrees:

1. **The browser already has a live session for the link's user:** go straight on, as from the
   dashboard.
2. **The browser has a session for a different user:** refused. The page names neither
   account beyond "this link was made for a different DataToRAG account than the one signed in
   here", and offers sign-out (the existing `POST /auth/logout`). The token is not spent.
3. **The browser has no session:** the POST sets a one-shot httpOnly cookie, `dtr_connect_link`,
   holding the link's id, with the link's remaining lifetime. The provider's start route and its
   callback accept that cookie as the user's identity **for the connect only**. No web session
   exists yet. At the callback, after the provider account's identity is known and before
   anything is stored:
   - if the provider account's email equals the link user's sign-in email (case-insensitive),
     the connect completes and a web session is minted for that user, so the landing works;
   - otherwise nothing is stored. The page says the account was not connected because DataToRAG
     needs to confirm it is you, and offers "Sign in to continue": a Google sign-in whose `next`
     restarts this connect. After that sign-in the browser is case 1 or case 2.

The common case, connecting the Google account you signed up with, is one button and the
provider's consent screen. The attack ends at "Sign in to continue", where the victim would
have to sign in as the attacker. **Ruling 2** asks whether the email-equality shortcut is
wanted at all, or whether a browser with no session should always sign in first, which is one
click more on a browser already signed in to Google.

The cookie is cleared at the top of the callback with the nonce, and
`auth-callback-ordering.test.ts` covers it. The session-minting code moves out of
`/auth/google/callback` into one function, `createWebSession(db, res, userId)`, used by both.

### The connect-done page

The connect started from a link ends on `/connect/done?service=<id>`: "Google Workspace is
connected. Go back to your assistant; it can use it now." It does not send the user to the
dashboard, because the conversation they came from is in another window, and it is what the
elicitation path waits on (section 4). The page needs no session. The URL carries only the
service id, so anyone can open it, and it says nothing a person could not see anyway.

## 2. One not-connected error

One helper in a new `gateway/not-connected.ts`, used at every gateway refusal point above
(no token, unknown `account`, refresh refused, missing scope):

```ts
notConnectedResult(input: {
  service: string;            // the connector id
  reason: "not_connected" | "no_such_account" | "reconnect" | "missing_scope";
  sentence: string;           // the existing sentence for that case
  link: string | null;        // a fresh connect link, null on the agent surface
}): CallToolResult
```

The result is `isError`, its text is the sentence followed by `Connect it here: <link>`, and
it carries `structuredContent: { error: "not_connected", reason, provider, next: "connect",
connect_url }`. A client that reads only text gets a link it can show. A client that reads
structured content gets the same thing as fields.

- **The link is issued per failure**, one `connect_links` row with `path: "tool_result"`.
- **The dashboard URL stays in the text** after the link. That keeps `connectionFailureService`
  recognising every case, and the regex gains the new sentences in the same change, with a test
  per reason. On the agent surface the text is today's, unchanged: the agent has
  `request_connection`.
- **These failures are tracked**: `trackToolCall` with outcome `user_error`, never metered,
  because a call that never reached a provider should not use the free tier's allowance. The
  missing-scope pre-check is tracked today as a metered user error, and moves to unmetered
  with the others. **Ruling 3.**
- "Used by all three plugins": the plugins never reach their own no-token messages, because the
  gateway refuses first, so the helper lives in the gateway and covers all three by
  construction. The one plugin-side case that is reachable, a provider rejecting a live token
  (Notion's reconnect message, carried in `_meta`), goes through the same helper in the
  dispatch's result handling with `reason: "reconnect"`.

## 3. The `connect` tool

A gateway built-in in `BUILT_IN_TOOLS`. `approval: "read"`, so `readOnlyHint` is true (it reads
the connection state and issues a link, and changes nothing the user owns). `attended: true`,
because nobody can click a link during a skill run. Not served on the agent surface: a new
`surfaces: ["mcp"]` field on the registry entry, checked where `attended` is.

Input: `{ service?: "google-workspace" | "atlassian" | "notion" }`, launched services only.
Output, one line per launched provider:

```
Google Workspace: connected as a@example.com (default), b@example.com
Atlassian: not connected. Connect it here: <link>
Notion: not connected. Connect it here: <link>
```

plus `structuredContent: { providers: [{ id, name, connected, accounts, connect_url }] }`.
Account emails are the user's own connected accounts, which `list_connected_accounts` already
returns to the same caller. When everything is connected the whole result is one sentence:
"Google Workspace, Atlassian and Notion are all connected. Nothing to do." and no link is
issued. With `service`, only that provider is reported, and a link is issued even when it is
connected, so "connect another Google account" works.

The tool is unmetered and does not count against the allowance, like `list_connected_accounts`.

### After a connect, the client sees the new tools

ListTools hides an unconnected provider's tools, so a connect that completes mid-conversation
changes the list. The server declares `tools: { listChanged: true }`, and when a connect
completes the gateway sends `notifications/tools/list_changed` on every live MCP session of
that user (the session map in `server.ts`, keyed by session id, gains a user index). A client
that ignores the notification still gets the new tools on its next `tools/list`.

## 4. URL-mode elicitation

Used only when `getClientCapabilities()?.elicitation?.url` is set. Without it, sections 2 and
3 are the whole path.

**On a not-connected refusal** in a session whose client supports URL mode, before returning
the error:

1. Issue a link with `path: "elicitation"` and send `elicitInput({ mode: "url", elicitationId:
   <link id>, url: <link>, message: "Connect Google Workspace to continue." })`, with a
   timeout of 10 minutes, the link's own lifetime.
2. **`decline` or `cancel`**: return the structured error of section 2 (a fresh link, the same
   text).
3. **`accept`**: accepting means the user agreed to open the URL, not that they finished. The
   call waits for that link's connect to complete, up to 5 minutes from the accept. The
   callback signals completion in process (an emitter keyed by link id) and, since the waiter
   may be on another process after a deploy, the waiter also re-reads the connection state
   every 5 seconds.
   - **Completed:** send the completion notification (`createElicitationCompletionNotifier`),
     then retry the original call once, through the same dispatch from the token resolution
     on. Its result is the call's result. A second failure is returned as it is, never retried
     again.
   - **Not completed in time:** return the structured error with a fresh link.

**On `connect`**, for each provider the user named (or the first unconnected one when none was
named), the same request, and on completion the tool reports the provider as connected.

**What holds the call open.** The response to the tool call is an SSE stream that stays open
while we wait. Nothing in the gateway times it out (no `requestTimeout` on the listener, and
Node's 300 seconds applies to receiving the request, not to the response). The edge is the
open question: a proxied stream that sends nothing for a long time may be closed. While waiting,
the server sends a progress notification every 20 seconds when the client gave a progress token,
and an SSE comment otherwise. That is verified against production before this is called done,
or written down as an expected failure.

**The alternative not taken.** The 2025-11-25 spec also lets a server refuse at once with
`URLElicitationRequiredError` (-32042) carrying the elicitation, and lets the client retry
the call itself. It holds nothing open, but whether a client retries is up to the client, and
the brief asks for our own retry. If the edge closes long streams, -32042 is the fallback.

**What the user sees.** Claude Code supports URL mode from 2.1.281: it shows the message and the
URL and asks to open it. Claude.ai, ChatGPT and Gemini are unknown. Each is tested once this is
deployed, and the report says what each advertised, read from the new capability fields
(below). Where a client does not advertise URL mode, it sees the tool result of section 2.

**Capabilities are recorded.** `mcp_session_initialized` gains `elicitation_form` and
`elicitation_url` (booleans), and the session's start log line prints them, so "what did each
client advertise" is a query, not a guess.

## 5. Server instructions

Passed as `instructions` in the initialize result. The same for every client: nothing found in
the code or the clients' documents gives a reason to vary them, and one text is one thing to
keep true. They are not sent on the agent surface, which has its own system prompt.

```
DataToRAG gives you tools for the user's Google Workspace, Atlassian and Notion.
Each provider's tools need that account connected first; until then they are not listed.
Call `connect` first to see what is connected and to get a link for anything that is not.
```

When Notion is not launched, its name is left out of the first line, by the same
`launchedServiceIds` the listing uses.

## 6. The 401 body

The body gains one field, `message`, after the two it has:

```json
{
  "error": "unauthorized",
  "resource_metadata": "<base>/.well-known/oauth-protected-resource",
  "message": "Sign in at <base>/auth/login. Setup guide: <base>/docs/getting-started."
}
```

The same sentence goes on the `invalid_token` form. The status, the `WWW-Authenticate` header,
`error` and `resource_metadata` do not change, and the SCRUM-464 refusal event and log line are
untouched.

## 7. Events

| Event | When | Properties |
|---|---|---|
| `connect_link_issued` | a link row is written | `provider`, `path` (`tool_result` or `elicitation`), `client_name` |
| `connect_completed` | a connect callback stores the account | `provider`, `path` (`tool_result`, `elicitation`, or `website` when the connect did not start from a link), `client_name` (null for `website`) |

No email and no account. `account_connected` keeps its existing properties; the two new events
exist so activation can be read by path, and `connect_completed` with `website` is the
baseline the chat paths are compared to. Both are captured under the user's id, so they join
the funnel.

## Overlaps

- **SCRUM-465** (salt wiring, log rotation, the leads limiter). None, unless Ruling 1 brings in
  a new key, which would ride on the same compose environment list. Not resolved here.
- **SCRUM-363 and SCRUM-96.** The duplicate branch runs unchanged inside a link-started connect;
  the connect-done page replaces the agent landing only for connects that started from a link.

## Tests

- `connect_links`: issue writes a hash, never the token; a claim succeeds once; a second claim,
  an expired link and an unknown token all fail the same way; the sweep removes old rows; the
  user's links go on sign-out and disconnect. Real Postgres for the claim.
- `GET /connect/<token>` spends nothing, and names the account only masked. The POST claims;
  a second POST shows the expired page; a cross-site POST is refused.
- Identity: a session for the link's user goes straight on; a session for another user is
  refused and the token is left unspent; no session plus a matching provider email completes
  and mints a session; no session plus a different email stores nothing in either table and
  mints nothing. The `dtr_connect_link` cookie is cleared first in each callback.
- `notConnectedResult` for each reason: text, structured content, the dashboard URL still
  present, `connectionFailureService` still reading the service; tracked and unmetered; the
  agent surface's text unchanged.
- `connect`: all connected gives the one sentence and issues nothing; one missing gives one
  link; `service` given issues a link even when connected; not listed on the agent surface or
  in an unattended session; unlaunched providers left out.
- Elicitation, with an in-memory client that declares `elicitation.url`: accept then complete
  retries once and returns the retried result; accept with no completion returns the error
  after the wait (fake timers); decline returns the error; a client with `elicitation: {}`
  gets no request at all.
- `list_changed` reaches each of the user's sessions and no one else's.
- Instructions present in initialize on the MCP surface, absent on the agent's.
- The 401 body: the `message` field in both forms, and the header byte for byte as before.
- Both events: properties as listed, no email anywhere in them.

## Ruling questions

1. **The link's shape.** Recommended: a hashed random token checked against `connect_links`, no
   new secret. Alternative: an HMAC under a new key in the parameter store, as the brief said.
2. **A browser with no session.** Recommended: complete when the provider account's email
   equals the user's sign-in email, otherwise ask them to sign in. Stricter: always sign in
   first.
3. **Not-connected failures are tracked and unmetered**, including the missing-scope pre-check,
   which is metered today.
4. **The elicitation wait.** 5 minutes after accept, inside the link's 10. Shorter keeps the
   chat responsive; longer suits a slow consent screen.
5. **Copy, for Manuel's sign-off:** the link page, the expired page, the different-account
   page, "Sign in to continue", the connect-done page, the not-connected sentence, the `connect`
   result, the three instruction lines and the 401 sentence. Every string above is a proposal;
   each one lands in code with a test that it has no em-dash.

Ruled (per SCRUM-466, 2026-10-30): 1, the hashed token, no new secret; 2, the email match, otherwise
sign in first; 3, tracked and unmetered, the missing-scope pre-check included; 4, five minutes
inside the link's ten; 5, the copy as proposed, each string with a no-em-dash test.

## Changed after the deploy (ruled 2026-10-31)

The first build held the tool call open on the elicitation: up to ten minutes for the client to
answer the prompt, then five after an accept, then a re-run of the call. In production a client
showed the prompt, nobody answered, the edge had cut the call's stream, and the client stayed
parked. Section 4 above is replaced by this:

- A not-connected refusal and `connect` answer at once, with the link in the result, for every
  client.
- When the client declared URL elicitation, the same link also goes out as `elicitation/create`,
  never awaited. Accept, decline or no answer change nothing, and nothing re-runs the call.
- When the link's connect completes, the callback marks `completed_at` and, best effort, sends
  `elicitation/complete` so the client can clear its prompt.
- `connect` naming a provider that is connected and working sends no prompt, only the add-account
  link.
- Routines and tests never call `connect` with a `service`.

The rule underneath: a tool call never waits on a person. The edge cuts an idle stream, and the
client cuts an idle call after five minutes on its own.

## As built

Where the build differs from the text above, and why.

- **The 401 sentence points at sign-in itself**, `<base>/auth/google`, not `/auth/login`: since
  SCRUM-408 nothing but a lapsed or unfinished sign-in points at the login page, and a test holds
  it. The resume after "Sign in to continue" goes the same way.
- **`connect_links` has a `completed_at` column.** The callback sets it, so a tool call waiting
  on a link finds the connect from any process; the in-process waiter is the fast path.
- **Links are not dropped on disconnect**, only on sign-out, account switch and grant revoke. A
  link only connects, so a disconnect gives no reason to cancel one.
- **The done page names a partial Google grant**: "connected, with some access missing", and what
  was not allowed.
- **A provider's 401 on a live token** gets the link and is unmetered, like the gateway's own
  refusals.
- **The elicitation goes on the tool call's own stream** (`relatedRequestId`), because a client
  need not hold the standalone stream open.
- **No SSE comment while waiting**: the SDK exposes none. Progress notifications go out every 20
  seconds when the call carried a progress token, and nothing otherwise.
- **A client's own call timeout can end the wait first.** The SDK's default for a client request
  is 60 seconds; a client that does not reset it on progress sees its own timeout. This is
  checked per client after the deploy, with the edge question.
- **The round trip's cookie holds the link's token**, looked up by hash, not the link's id: the id
  is a database key and no secret. An elicitation gets its own random id for the same reason.
- **The email match needs a verified email.** With no session, the connect completes only when
  Google (`verified_email`) or Atlassian (`email_verified`) say they verified the address; Notion
  reports no flag and its owner email is accepted. An unverified address asks for a sign-in.
- **After "Sign in to continue"**, the resumed connect carries no link, so a call waiting on the
  first link ends at the wait and answers with a fresh one.
- **Copy added in the build**, beyond what was proposed: the `connect` tool's "Connect another
  account here:", "Reconnect it here:", "needs reconnecting" and its no-link line; the partial
  grant page; the tool's description; the elicitation message "Connect <service> to continue.";
  the docs section "Connect accounts from your assistant".
