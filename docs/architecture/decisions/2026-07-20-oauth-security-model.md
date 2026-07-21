# Gateway OAuth: public-clients-only + PKCE, signed session-bound state, revoke tears everything down

- **Date:** 2026-07-20
- **Who:** Manuel + Claude (product session, from the 2026-07-20 security review)
- **Status:** accepted
- **Log line:** 2026-07-20 · Gateway OAuth = public-clients-only with PKCE; state is signed and session-bound; revoke tears down access tokens AND live MCP/SSE sessions

## Context

The 2026-07-20 security review of the gateway's OAuth authorization server found the
P0 cluster this ADR resolves: metadata advertised `client_secret_post` while no secret
was ever issued or verified; `state` was unauthenticated (credential/auth-code
injection vectors); revoking a refresh token left the grant's access tokens — and
already-open SSE streams — alive; `/oauth/*` had no rate limiting. Key commits:
`b557ad2`, `c2e654c` (SEC-4/5), `8b48ecc` (SEC-8), `94c58cb` (SEC-7/DRY-1).

## Alternatives considered

- **Confidential clients (issue real client secrets)** — MCP clients are distributed
  desktop/web apps that cannot keep a secret; advertising secret auth without
  enforcing it was worse than honesty. Public-client + mandatory PKCE (S256) is the
  correct OAuth 2.1 posture; dynamic registrations are recorded and echoed as auth
  method `none` regardless of what was requested.
- **Trusting `X-Forwarded-For` for rate-limit keying** — Cloudflare appends to XFF,
  so the leftmost entry is client-supplied: an attacker could evade the per-IP cap or
  pin it onto a victim's IP. The bucket key is `CF-Connecting-IP` (authoritative,
  since the origin only accepts Cloudflare traffic), falling back to the TCP peer.
- **Revoke = mark token dead in DB only** — DB-side revocation 401s *new* requests,
  but an open SSE stream keeps flowing until transport close. Revoke must also close
  the user's live sessions; clients with still-valid bearers re-initialize silently
  through the 404 path (see the session-survival ADR), so only the revoked client
  stays out.
- **Per-route hand-rolled auth** — the review found the missed-auth/leaked-`Error.
  message` bug class comes from repetition. All session-gated JSON routes now go
  through one `withRoute` wrapper (session guard, per-user rate limit, generic-500
  catch-all).

## Decision

The gateway is an honest public-client PKCE authorization server. `state` carries a
signed value matched against an httpOnly nonce cookie, and identity comes from the
session, never from `state`. Revocation is total: refresh-token revoke (or replay)
kills the grant's access tokens scoped to (userId, clientId), and `/oauth/revoke`
fires `onRevoked(userId)` to close live MCP/SSE sessions. `/oauth/*` is rate-limited
per-IP keyed on `CF-Connecting-IP`. Error text is redacted before any egress
(client responses and analytics alike).

## Consequences

- Any future connector or auth flow inherits this reference model: PKCE required,
  session-derived identity, nonce-bound state, total revocation.
- `CF-Connecting-IP` trust is only sound while the origin is reachable exclusively
  through Cloudflare — infra changes that expose the origin re-open the spoof vector
  (the direct-to-origin fallback keys on the TCP peer).
- New session-gated routes must use `withRoute`; bespoke handling is reserved for the
  redirect-based connect flows with their own CSRF-cookie logic.
