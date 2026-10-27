# Auth hardening: OAuth only, token kinds, hashed tokens, and a consent page (SCRUM-451, SCRUM-374, SCRUM-443, SCRUM-373)

Status: spec, written from the code at `2c5be1b`, with its decisions ruled on 2026-10-26 (the
last section). Nothing here is built. It is built in this order, each on its own go: 451, then 374,
then 443 (three releases), then 373.

- **SCRUM-451.** API keys are removed: OAuth is the only way into the gateway. The dashboard page,
  the `/api/keys` routes and the bearer's key path go, with every mention of keys in the product
  and its documents. The only user-visible change apart from 373.
- **SCRUM-374.** A web session token and an MCP access token are told apart everywhere they are
  read, and every connect callback checks that its session is live. Invisible to users.
- **SCRUM-443.** Gateway access tokens (web sessions and MCP bearers) and authorization codes are
  stored as hashes, through a dual-read release so nobody is signed out. Invisible to users.
- **SCRUM-373.** A consent page of our own, naming the client and where it sends you, before the
  gateway issues an authorization code; and redirect URI rules at registration. The only
  user-visible change: one Approve per new client.

## What exists today (the code this builds on)

### One table, two kinds of token

`oauth_access_tokens` (`packages/db/src/schema/oauth.ts`) holds both:

- **Web sessions.** `GET /auth/google/callback` in `gateway/auth.ts` inserts a row with
  `client_id = "web"`, a 24-hour expiry, and sets the raw token as the `dtrmcp_session` cookie.
- **MCP access tokens.** `POST /oauth/token` in `gateway/oauth/token.ts` inserts a row with the
  registering client's `client_id`, a 24-hour expiry, beside a refresh token stored as
  `sha256(raw)` in `oauth_refresh_tokens` (rotated, with family revocation on replay).

API keys live in `api_keys`, stored as `sha256(raw)` with a display prefix
(`gateway/bearer-auth.ts`, `createApiKey`), until SCRUM-451 removes them. Authorization codes live in
`oauth_authorization_codes.code`, raw, with a 10-minute expiry and a `used_at`.

### Every place a token is read

These are the readers the change touches; each one's rule after the change is in the sections
below.

- `lib/session.ts` `getSessionUserId`: the cookie, for every Next route through `withRoute` and
  `withAdminRoute`, and the server components.
- `gateway/bearer-auth.ts` `resolveBearer`: the `/mcp` bearer, an API key by `key_hash`, else an
  access token. After 451, an access token only.
- `gateway/auth.ts`: the Google, Atlassian and Notion connect starts and callbacks, and
  `POST /auth/connect/anyway`, which read the cookie; `POST /auth/logout` and
  `POST /auth/connect/switch-account`, which revoke by it.
- `gateway/oauth/token.ts`: the code exchange, by code.
- `gateway/oauth/revoke.ts` and `grants.ts`: refresh tokens by hash, access tokens by user and
  client.
- `app/api/setup/status/route.ts`: a user's live access tokens other than web sessions.
- `proxy.ts`: the cookie's presence only, for the `/dashboard` bounce; the route's own lookup is
  the check.

### Registration and authorization

- `POST /oauth/register` (`register.ts`) registers a public client
  (`token_endpoint_auth_method: "none"`, PKCE being the protection) with its `redirect_uris`.
- `GET /oauth/authorize` (`authorize.ts`) validates the client and that `redirect_uri` is one it
  registered, sets the `mcp_oauth_nonce` cookie, and sends the browser to Google's account
  chooser with the flow in `state`. `GET /oauth/callback` checks the nonce, re-checks the redirect
  URI, signs the user in with Google, finds or creates the user, issues a code and redirects to
  the client.

### Tests

Each part below lists the tests it adds, on `authorize.ts`, `register.ts`, `lib/session.ts` and
`bearer-auth.ts` among others, beside the suites those files already have.

## SCRUM-451: OAuth is the only way in

Every MCP client this product supports connects with OAuth, so a second credential is a second
surface to secure for no client that needs it. Removing it breaks no client that connects with
OAuth; the evidence is in the ticket. This supersedes the earlier SCRUM-374 rule for minting a key
from a recent sign-in: there is no minting.

### What is removed

- **The dashboard:** the API keys page and panel (`app/dashboard/api-keys/`) and its entry in the
  dashboard navigation (`app/dashboard/layout.tsx`). The old path redirects to `/dashboard`.
- **The routes:** `app/api/keys/route.ts` and `app/api/keys/[id]/route.ts`.
- **The bearer:** `resolveBearer` accepts an OAuth access token and nothing else. A value shaped
  like a key is an unknown token, refused as `invalid` with the same challenge as any other.
  `createApiKey`, `touchApiKey` and its call in `server.ts`, `API_KEY_CLIENT_ID`, and the
  `api_key` value of `authKind` on `mcp_session_initialized` go.
- **`packages/auth`:** `generateApiKey`, `getKeyPrefix`, the key prefix and `ApiKeyValidator` go.
  `hashApiKey` stays, because refresh tokens are hashed with it and 443 hashes access tokens and
  codes with it; it is renamed `hashToken`, with its callers, in the same change.
- **Words:** the home page line about keys; the README's mention of keys for scripts and agents,
  its dashboard row and its `packages/auth` description; the terms' section on keys (the sections
  after it renumbered) and the sentence on keeping them secure; the privacy policy's clause on generating and managing keys;
  comments that name keys as a credential (`lifecycle.ts`, `admin-surface-walk.ts`,
  `tests/execute.ts`, the agent's client cache in `mastra/agents/datatorag.ts`), reworded or
  removed. The terms and privacy pages carry a new effective date. No docs page and no blog post
  claims DataToRAG offers keys (the comparison posts describe other products' keys, and one says
  DataToRAG needs none), so no post gets an edited note.
- **The runner:** case F7 ("a fabricated API key is refused") stays, renamed to say what it now
  proves: a bearer that is not an OAuth access token is refused with a usable challenge.

### The live key, and the table

The release that removes the code carries a journaled migration that revokes every key still
live: `UPDATE api_keys SET revoked_at = now() WHERE revoked_at IS NULL`. The table stays for that
one release, so rolling the image back refuses a key instead of failing on a missing table. A
journaled migration in the 374 release then drops `api_keys`, once nothing in the running image
reads it.

The revoke runs once the old container has stopped serving, so no key can be minted between it
and the switch. A rollback of the 451 image brings the key routes back until the roll forward, so
the rollback step runs the same revoke again first, and the runbook says the routes are live in
that window.

### Changelog (451)

"API keys are gone; every client connects with OAuth." With one line on where to connect a
client instead (the getting started guide).

### Tests (451)

- `resolveBearer`: a value in the old key format, a revoked key's raw value, and an unknown token
  are each refused as `invalid` with the challenge; an OAuth access token resolves.
- `/api/keys` and `/api/keys/<id>` are 404 for a signed-in user; `/dashboard/api-keys` redirects.
- The dashboard navigation has no keys entry.
- The migration, on real Postgres: a live key is revoked, a revoked key keeps its time.
- A source test: nothing under `apps/gateway/src` or `packages` imports a removed name.

## SCRUM-374: token kinds and live sessions

### One session lookup

A single helper, `liveWebSessionUserId(db, rawToken): Promise<string | null>`, in
`lib/session.ts` beside `getSessionUserId`, which becomes a thin wrapper over it. It matches
`client_id = 'web'` plus `liveTokenConditions()`. Every reader of the cookie uses it:

- `getSessionUserId` (and so `withRoute`, `withAdminRoute`, the server components);
- the three connect callbacks and `POST /auth/connect/anyway` in `auth.ts`, replacing their
  inline lookups.

The three connect start routes check the cookie's presence before sending the browser to the
provider. They switch to the helper too, so an expired or revoked session is sent to sign in
before the round trip rather than after it.

### The bearer refuses a web session

`resolveBearer`'s access-token branch adds `client_id <> 'web'` to its match. A web session
presented on `/mcp` is refused as `invalid`, with a new `AuthFailureReason`, `wrong_token_kind`,
so the analytics can tell it from an unknown token. The dashboard agent is an in-process client
of the MCP server and never presents a bearer, so it is unaffected.

### Tests (374)

- `lib/session.ts`: a live web token resolves; an MCP client's live token, a revoked web token and
  an expired web token do not.
- `resolveBearer`: an MCP token resolves; a live web token is refused as `wrong_token_kind`.
- Each connect callback (Google, Atlassian, Notion) and `/auth/connect/anyway`: a revoked, an
  expired, and a non-web session each go to sign in, and nothing is stored.
- The `api_keys` drop migration runs clean on a database where 451's revoke has run.
- `with-admin-route`: an MCP token set as the cookie is a 404, like no session.

## SCRUM-443: hashed tokens, through a dual-read release

### What changes

- `oauth_access_tokens` gains `token_hash text` (nullable, unique). The value is
  `sha256(raw)` as hex, the same function as refresh tokens (`hashToken`, renamed from
  `hashApiKey` by 451).
- `oauth_authorization_codes` gains `code_hash text` (nullable, unique), the same way.
- The raw values (`token`, `code`) are dropped at the end. The cookie and the bearer still carry
  the raw token; the gateway hashes what it is handed and looks the hash up.

No key is involved, so unlike SCRUM-442 the backfill can be journaled SQL: Postgres computes the
same value as `encode(sha256(convert_to(token, 'UTF8')), 'hex')`.

### Three releases, nobody signed out

Each release is its own deploy; each production migration is confirmed, naming its target,
before it runs.

| Release | Schema | Code | Rollback |
|---|---|---|---|
| 1. Write both | migration 1: add `token_hash` and `code_hash`, nullable | every insert of an access token (web login, code exchange, refresh) and of a code writes the hash beside the raw value; every read still matches the raw value | previous sha: it ignores the new columns |
| 2. Read the hash | migration 2, run before the image: (a) fill `token_hash` for every LIVE access token whose hash is null; (b) a `DO` block that raises if any live access token still has a null hash | every read (session, bearer, logout, switch, the code exchange) matches the hash; inserts still write both | release 1's sha: it reads the raw value, which release 2 keeps writing |
| 3. Drop the raw values | migration A: `token` and `code` nullable. Then, after a soak, migration B: a guard, then drop both columns | inserts write the hash only; the schema no longer has the raw columns | before B: release 2's sha, which reads the hash for every row. After B: re-add the columns (nothing to restore: the raw values are not needed by release 2) |

**Why nobody is signed out.** Release 1 hashes every new token. Migration 2 hashes every live
token issued before release 1, and refuses to finish if one is left, so when release 2 starts
reading hashes, every live session and every live MCP token has one. Authorization codes need no
backfill: they live 10 minutes, so any code issued before release 1 has expired by the time
release 2 ships, provided the two deploys are at least 10 minutes apart.

**Rows whose raw value is already gone.** While the raw columns exist, every row has one (`token`
and `code` are `NOT NULL` until release 3). The backfill hashes live rows only: a revoked or
expired token never authenticates again, so it is left with a null hash and simply never matches,
which is what it would do anyway. After release 3 no raw value exists anywhere and there is
nothing to backfill: a lost row is a token nobody can present, and the client re-authorizes (an
MCP client through its refresh token, a browser by signing in), exactly as after a 24-hour
expiry.

**Refresh tokens** are already hashed and do not change.

### Tests (443)

- Each write site writes a hash equal to `hashApiKey(raw)`; in releases 1 and 2 the raw value
  beside it.
- Session, bearer and code exchange resolve by hash in release 2, and a row with only a raw value
  (simulated) is refused there.
- Migration 2 refuses while a live token has no hash, and hashes exactly what `hashApiKey` would
  (one fixture, both computed).
- A read of the table after release 3 shows no raw token (the column is gone).

## SCRUM-373: consent, and redirect URI rules

### Registration rules

`POST /oauth/register` refuses (`invalid_redirect_uri`) unless `redirect_uris` is an array of 1
to 5 **strings**, each at most 512 characters, each a URL that parses, with no fragment, and
either:

- `https:` with a host, or
- `http:` with host `localhost`, `127.0.0.1` or `[::1]` (a loopback, any port);

and with no userinfo (`user:pass@`) in the URL.

Any other scheme, including custom app schemes, is refused. `client_name` is capped at 100
characters and cleaned of control characters, because the consent page shows it.

**The known clients**, from each client's documented OAuth behaviour:

| Client | Redirect URIs it registers | Passes |
|---|---|---|
| Claude (web and Desktop) | `https://claude.ai/...` | yes |
| Claude Code | `http://localhost:<port>/...` | yes |
| Cursor | `https://www.cursor.com/...` and `http://localhost:<port>/...` | yes |
| Codex | its documented OAuth flow uses a loopback callback, which passes; a custom scheme would not | expected yes; fixed forward if not |

Existing registrations are not re-validated: the rule applies at registration.

### The consent page

After Google sign-in, `GET /oauth/callback` knows who the user is. Instead of issuing a code at
once, it checks `oauth_consents` (new: `user_id`, `client_id`, `created_at`, unique on the pair).

- **Remembered:** the code is issued as today.
- **Not yet approved:** the callback stores the validated flow (client, redirect URI, PKCE
  challenge, state, scope, user) in `oauth_pending_consents` (new: an id, the sha256 of a consent
  nonce, the flow, a 10-minute expiry, `used_at`), sets the nonce in an httpOnly, Secure,
  SameSite=Lax cookie, `mcp_consent_nonce`, scoped to the path `/oauth/consent` and cleared once
  used, and renders the consent page.

The page is a self-contained Express page like the connect pages. Its Approve and Deny are form
POSTs to `/oauth/consent` carrying the pending id. The route:

1. refuses a request from another origin (403), and fails closed when neither `Origin` nor
   `Sec-Fetch-Site` is present;
2. requires the cookie nonce to hash to the pending row's nonce hash (constant-time), the row to be
   unused and unexpired, and marks it used whatever happens next;
3. on **Approve**: records the consent, issues the code exactly as the callback does today, and
   redirects to the registered redirect URI with `code` and `state`;
4. on **Deny**: redirects to the redirect URI with `error=access_denied` and `state`
   (RFC 6749 section 4.1.2.1), and records nothing.

The page is never framed: the gateway's global `frame-ancestors 'none'` and `X-Frame-Options:
DENY` apply to it like every other response.

**Proposed copy:**

> **Allow <client name> to use DataToRAG?**
> <client name> will be able to use the tools for the accounts you have connected, as
> <user's email>. It will be sent back to **<redirect host>**.
> Only approve an app you just added yourself.
> [Approve] [Deny]

When the client sent no name, it reads "an app" and the redirect host does the naming. The
redirect host is shown as the host only (`claude.ai`, `localhost`), never the full URL, and in
its ASCII (punycode) form, so a lookalike internationalised name cannot pass for a familiar one.

### Changelog (373 only)

One entry when 373 ships, in the user's terms: the first time a new app connects to DataToRAG,
you now see a page naming the app and where it sends you, with Approve and Deny, and it is
remembered for that app. No mention of the reason.

### Tests (373)

- `register.ts`: each refused shape (not an array, a non-string element, six URIs, a 513-character
  URI, `javascript:`, a custom scheme, `http` on a non-loopback host, a fragment, a URI with userinfo) and each
  accepted one (`https`, `http://localhost:port`, `http://127.0.0.1:port`, `http://[::1]:port`).
- `authorize.ts` callback: no consent on record renders the page and issues no code; a remembered
  consent issues a code with no page.
- `/oauth/consent`: Approve issues one code and records the consent; Deny redirects with
  `access_denied` and records nothing; a wrong nonce, a reused or expired pending row, a
  cross-origin POST, and a POST with neither `Origin` nor `Sec-Fetch-Site` each issue nothing.
- The page escapes the client name and shows the redirect host only, an internationalised host
  in its punycode form.

## Not done, on purpose

- Re-validating existing client registrations.
- A page listing and revoking remembered consents (a follow-up ticket; revoking a client's
  tokens already exists through `/oauth/revoke`).
- Confidential clients or client secrets.
- Any change to refresh tokens.

## Decisions (ruled 2026-10-26)

1. **API keys.** There are none: OAuth is the only way into the gateway (SCRUM-451, ruled
   2026-10-26). This replaces the earlier ruling on minting keys from a recent sign-in.
2. **What consent is remembered against.** `(user, client_id)`, as the ticket says. Claude Code's
   users see the page again for each new registration it makes; that is accepted over keying on
   values the client asserts.
3. **Codex.** The redirect rule ships as written: `https`, or `http` on a loopback host. If Codex
   turns out to register a custom scheme, that is fixed forward after 373 ships; 373 is not held
   for it.
