# Auth hardening: token kinds, hashed tokens, and a consent page (SCRUM-374, SCRUM-443, SCRUM-373)

Status: spec, written from the code at `2c5be1b`. Nothing here is built. After review it is built
as three pull requests, in this order: 374, then 443, then 373.

- **SCRUM-374.** A web session token and an MCP access token are told apart everywhere they are
  read, every connect callback checks that its session is live, and an API key can only be minted
  from a recent sign-in. Invisible to users.
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
(`gateway/bearer-auth.ts`, `createApiKey`). Authorization codes live in
`oauth_authorization_codes.code`, raw, with a 10-minute expiry and a `used_at`.

### Every place a token is read

These are the readers the change touches; each one's rule after the change is in the sections
below.

- `lib/session.ts` `getSessionUserId`: the cookie, for every Next route through `withRoute` and
  `withAdminRoute`, and the server components.
- `gateway/bearer-auth.ts` `resolveBearer`: the `/mcp` bearer, an API key by `key_hash`, else an
  access token.
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

## SCRUM-374: token kinds, live sessions, and key minting

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

### Minting an API key needs a recent sign-in

An API key does not expire and outlives the session that made it. Tying keys to the session's
lifetime would revoke them at every logout and every 24-hour expiry, which is not what a key is
for. So minting requires a **recent sign-in** instead: `POST /api/keys` checks that the web
session's `created_at` is within the last 10 minutes; otherwise it answers 403 with
`reauth_required`, and the API keys page sends the user through sign-in with `next` back to the
page, after which the mint succeeds. Listing and revoking keys are unchanged.

### Tests (374)

- `lib/session.ts`: a live web token resolves; an MCP client's live token, a revoked web token and
  an expired web token do not.
- `resolveBearer`: an MCP token resolves; a live web token is refused as `wrong_token_kind`; API
  keys unchanged.
- Each connect callback (Google, Atlassian, Notion) and `/auth/connect/anyway`: a revoked, an
  expired, and a non-web session each go to sign in, and nothing is stored.
- `POST /api/keys`: refused with `reauth_required` on a session older than the window, accepted on
  a fresh one.
- `with-admin-route`: an MCP token set as the cookie is a 404, like no session.

## SCRUM-443: hashed tokens, through a dual-read release

### What changes

- `oauth_access_tokens` gains `token_hash text` (nullable, unique). The value is
  `sha256(raw)` as hex, the same function as refresh tokens and API keys (`hashApiKey`).
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

**Refresh tokens and API keys** are already hashed and do not change.

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
| Codex | its documented OAuth flow uses a loopback callback, which passes; a custom scheme would not | to verify before 373 ships |

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
- Any change to refresh tokens or API keys beyond the recent-sign-in rule for minting.

## Decisions to rule on

1. **API keys and sessions.** This spec requires a sign-in within 10 minutes to mint a key and
   leaves existing keys alone. The alternative revokes a key when the session that minted it is
   revoked, which also kills keys at every logout.
2. **What consent is remembered against.** This spec keys it on `(user, client_id)`, as the
   ticket says. Claude Code registers a new client per local callback port, so its users would see
   the page again on each new registration. Keying on client name plus redirect host would ask
   less often, but both are values the client asserts.
3. **Codex.** Ship the scheme rule as written and fix forward if Codex turns out to register a
   custom scheme, or verify Codex's registration first and hold 373 until then.
