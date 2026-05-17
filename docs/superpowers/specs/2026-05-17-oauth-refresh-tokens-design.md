# OAuth Refresh Tokens — Design Spec

**Date:** 2026-05-17
**Status:** Approved, ready for implementation planning
**Depends on:** Existing `oauth_access_tokens` schema (already shipped)

## Summary

Add refresh-token support to the DataToRAG MCP gateway's OAuth 2.1 authorization server so MCP clients (Claude Desktop, Claude Code) stop forcing users through the full browser OAuth dance every 24 hours. Today, `apps/gateway/src/gateway/oauth/token.ts` issues an access token with `expires_in: 86400` and **no** `refresh_token`. The metadata at `/.well-known/oauth-authorization-server` advertises only `grant_types_supported: ["authorization_code"]`. After 24h, the access token expires, `/mcp` returns 401, and the client has no protocol-defined path back — it must restart the full auth flow.

The fix is the OAuth 2.1 standard refresh-token shape: short-lived access tokens (1h), long-lived refresh tokens (60d) stored as SHA-256 hashes, one-time use with rotation, server-side replay detection that revokes the entire token family on suspected compromise, and an RFC 7009 revocation endpoint.

## Goals

- MCP clients refresh silently for at least 60 days without user re-consent.
- Reduce access-token blast radius from 24h to 1h.
- Detect refresh-token replay (a sign of token theft) and revoke the family.
- Refresh tokens are not readable from the DB (sha256 hashed at rest).
- Users can explicitly revoke a refresh token via RFC 7009.
- Backward-compatible rollout: existing 24h access tokens stay valid until they expire naturally.

## Non-Goals

- Changing the dashboard session cookie (`dtrmcp_session`) lifecycle. That's a separate authentication path and has its own UX (a user re-logging into the dashboard once a day is fine; an LLM reconnecting its MCP every day is not).
- Changing service-token refresh (`service_connections`). Google/Atlassian token refresh is already implemented in `apps/gateway/src/gateway/service-token.ts` and works correctly.
- Per-client refresh-token TTL configuration. One global 60d default.
- Admin revoke UI for revoking tokens on behalf of users. Future work; for now, support requests can run SQL.
- Refresh-token introspection endpoint (RFC 7662). Future work.

## Threat Model

A refresh token is a long-lived bearer credential. Theft is the primary risk:

- **Token leaked via logs / error reports / process dump.** Mitigation: never log token values; redact in error paths. Spec mandates: never log the raw token; logging the hash is acceptable.
- **Token leaked via XSS or supply-chain compromise of the client.** Mitigation: rotation + replay detection. If the attacker uses the leaked refresh token before the legitimate client rotates it, both sides cannot both succeed — the second use reveals the compromise and we revoke the family.
- **Token leaked via DB exfiltration (logical replica, backup leak, SQLi).** Mitigation: store `sha256(token)` only. The DB never holds the raw token. An exfiltrated row cannot be replayed against `/oauth/token`.
- **Token replay after legitimate rotation.** Mitigation: refresh tokens are one-time use. Presenting a revoked refresh token revokes the entire family (all descendants).
- **Race between parallel refreshes.** When a client reconnects, two MCP transports may fire `refresh_token` requests in parallel. Both could read `revoked_at IS NULL`, both rotate, and the family bifurcates — replay detection then never triggers because both branches look legitimate. Mitigation: the entire lookup-validate-rotate is one transaction with `SELECT ... FOR UPDATE` on the refresh-token row. Second concurrent request blocks until the first commits, then re-reads and sees `revoked_at` set → replay branch.

## Token Lifetimes

| Token | Old TTL | New TTL | Notes |
|---|---|---|---|
| Authorization code | 60s (unchanged) | 60s | Already short |
| Access token (MCP) | 24h | **1h** | Drop in PR3, after refresh path is observed working in prod |
| Refresh token (MCP) | n/a | **60d** | New. Fixed from issuance; not sliding. |
| Dashboard session (`oauth_access_tokens` with `clientId='web'`) | 24h | 24h (unchanged) | Out of scope |

60d refresh TTL chosen as a balance: long enough that idle clients (e.g. Claude Desktop closed for a vacation) survive, short enough that an abandoned device eventually loses access. A user who has not touched the MCP for 60 days reconsenting is acceptable UX.

## Schema

New table `oauth_refresh_tokens`. Note the column is `token_hash`, not `token` — we never persist the raw token.

```typescript
export const oauthRefreshTokens = pgTable(
  "oauth_refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    clientId: text("client_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedByTokenId: uuid("replaced_by_token_id"),
    familyId: uuid("family_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_oauth_refresh_tokens_user").on(table.userId),
    index("idx_oauth_refresh_tokens_family").on(table.familyId),
  ]
);
```

The raw refresh token is returned to the client once (in the token response) and then exists only in the client. The DB stores `sha256(rawToken).toString("hex")`. Lookup on refresh is by hash.

No changes to `oauth_access_tokens`. Existing access tokens continue to work; they simply have no associated refresh token. The refresh table is additive.

**Race protection.** The race fix is `SELECT ... FOR UPDATE` inside a single transaction (see §"Refresh Grant Branch"). A partial unique index on `(family_id) WHERE revoked_at IS NULL` was considered as a belt-and-suspenders defense but rejected: during a legitimate rotation the new and old rows both have `revoked_at IS NULL` momentarily inside the same transaction, which would either deadlock or require careful ordering. FOR UPDATE alone is the canonical Postgres pattern and is sufficient.

## Issuance Path (authorization_code grant)

In `apps/gateway/src/gateway/oauth/token.ts`, after the PKCE check and authorization-code consumption:

1. Generate access token (existing). TTL: 1h once §"Rollout" reaches PR3. PR1 keeps it at 24h.
2. Generate raw refresh token: `randomBytes(32).toString("base64url")`. TTL: 60d. `familyId = randomUUID()`.
3. Compute `tokenHash = sha256(rawRefreshToken).hex`.
4. Insert access-token row + refresh-token row (with `tokenHash`, not the raw token) in a single transaction.
5. Response includes the raw `refresh_token`:

```json
{
  "access_token": "...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "...",
  "scope": "mcp:tools"
}
```

The raw refresh token is sent over the wire once. After this response, only its hash exists server-side.

## Refresh Grant Branch

New branch in `token.ts` for `grant_type=refresh_token`. The **entire** lookup-validate-rotate runs in a single transaction with row-level locking.

**Inputs:** `grant_type=refresh_token`, `refresh_token`, `client_id` (per OAuth 2.1 for public clients).

**Algorithm:**

```
BEGIN TRANSACTION

  hash := sha256(refresh_token)

  row := SELECT * FROM oauth_refresh_tokens
         WHERE token_hash = :hash
         FOR UPDATE                              -- serialize parallel refreshes

  if row IS NULL                  → 400 invalid_grant ("unknown")
  if row.clientId != client_id    → 400 invalid_grant ("client mismatch")
  if row.expiresAt < now()        → 400 invalid_grant ("expired"); emit oauth_refresh_expired
  if row.revokedAt IS NOT NULL    → REPLAY
                                      UPDATE oauth_refresh_tokens
                                        SET revoked_at = now()
                                      WHERE family_id = row.familyId
                                        AND revoked_at IS NULL
                                      emit oauth_refresh_replay
                                      → 400 invalid_grant ("revoked")

  generate newAccessToken, newRefreshToken (raw, base64url)
  newRefreshHash := sha256(newRefreshToken)

  INSERT INTO oauth_access_tokens (newAccessToken, …, expires_at = now + 1h)
  INSERT INTO oauth_refresh_tokens (token_hash = newRefreshHash, family_id = row.familyId, …)
         RETURNING id AS newId
  UPDATE oauth_refresh_tokens
    SET revoked_at = now(), replaced_by_token_id = newId
    WHERE id = row.id

COMMIT

emit oauth_refresh_succeeded
respond 200 with { access_token, refresh_token = newRefreshToken, expires_in, scope }
```

The old access token, if any, is **not** revoked on refresh. It expires on its own short TTL. Eagerly revoking it is unnecessary and would require an extra DB write per refresh.

`SELECT ... FOR UPDATE` is the critical line: two parallel `refresh_token` requests with the same token both block at this select until one commits. The second then reads `revoked_at` populated and falls into the replay branch.

## Revocation Endpoint (RFC 7009)

New endpoint `POST /oauth/revoke` so a user (or an attacker-recovery flow) can explicitly kill a refresh token.

**Inputs:** `token`, `token_type_hint=refresh_token` (optional), `client_id`.

**Behavior:**
1. Compute `hash = sha256(token)`.
2. `SELECT … FOR UPDATE` the row.
3. If found and `client_id` matches: set `revoked_at = now()` for this row **and all rows in the same family** (revoking a refresh token revokes its descendants too — same family-revoke semantics as replay).
4. Always return `200 OK` with empty body, per RFC 7009 — do not leak whether the token was valid.
5. Emit `oauth_token_revoked` PostHog event with `distinctId = userId, clientId, familyId`.

Access tokens are out of scope for this endpoint in v1. They expire in ≤1h once PR3 ships; explicit revocation matters mainly for the long-lived refresh token. (Adding access-token support is ~5 LOC and can be tacked on later if support requests need it.)

`grant_types_supported` does not advertise revocation — that's `revocation_endpoint` in metadata, which we add in PR2.

## Metadata Endpoint

`apps/gateway/src/gateway/oauth/metadata.ts` updates `grant_types_supported` **only in PR2**, not PR1, to keep the metadata honest at all times:

```typescript
grant_types_supported: ["authorization_code", "refresh_token"],
revocation_endpoint: `${baseUrl}/oauth/revoke`,
revocation_endpoint_auth_methods_supported: ["none", "client_secret_post"],
```

Advertising `refresh_token` before the endpoint handles it would be a spec lie. PR1 still issues refresh tokens (clients store them, can't yet use them); PR2 simultaneously ships the refresh-grant branch, the revocation endpoint, and the metadata update.

## Registration Endpoint

`apps/gateway/src/gateway/oauth/register.ts` already accepts `grant_types` from the client and defaults to `["authorization_code"]`. Update the default to `["authorization_code", "refresh_token"]` in **PR1**. This is safe even before PR2 ships because the registration record reflects what the client may use, not what the server currently honors — and an existing client requesting both grant types and getting `unsupported_grant_type` on refresh is the same observable behavior as today's clients (they re-auth). Existing registered clients keep whatever they originally registered with; Anthropic's MCP client re-registers on schema mismatch, so this self-heals.

## Replay Detection (Worked Example)

1. Client legitimately refreshes: `RT1 → RT2`. Inside the same tx: `RT1.revokedAt = now`, `RT1.replacedByTokenId = RT2.id`, `RT2` inserted. Both share `familyId = F`.
2. Client refreshes again: `RT2 → RT3`. Same family. `RT2.revokedAt = now`.
3. Attacker had captured the raw `RT1` earlier. They present `RT1`.
4. Server hashes it, finds the row, sees `RT1.revokedAt IS NOT NULL` → replay.
5. Server revokes all rows where `family_id = F AND revoked_at IS NULL` — that's `RT3` (the current legitimate token).
6. The legitimate client's next refresh attempt presents `RT3` → fails with `invalid_grant` → forced back through the full authorization-code flow with user consent. UX hit, but necessary: at this point we don't know which side was compromised.

If parallel requests race in step 1, the second request blocks on `FOR UPDATE`, then reads `RT1.revokedAt` populated, and goes through step 4–5 — which means a *false-positive* replay can happen if a buggy client sends two parallel refreshes. This is acceptable: a well-behaved client serializes refresh requests; a client that does not should be detected and forced to fix it.

## Rollout Order

Three sequential PRs. PR1 is invisible to clients (issues refresh tokens but cannot yet use them; metadata unchanged). PR2 ships all user-observable behavior atomically: refresh-grant branch, revocation endpoint, and metadata advertising both. PR3 drops the access TTL to 1h once PR2 telemetry has been clean for ≥7 days.

**PR1 — Schema and issuance (additive, no user-visible behavior change):**
- Add `oauth_refresh_tokens` schema with `token_hash` column.
- Generate migration (`pnpm --filter @datatorag-mcp/db db:generate`).
- Modify `token.ts` issuance branch: hash the new refresh token, insert hash+raw-return.
- Modify `register.ts` default `grant_types` to include `refresh_token`.
- **Do not modify `metadata.ts`.** Clients see no advertised refresh_token grant yet. They simply receive a `refresh_token` they cannot use until PR2.
- Access TTL stays at 24h.
- Build test harness (Task 0) — this is the first set of integration tests in the gateway.

**PR2 — Refresh-grant branch, revocation endpoint, and metadata update (atomic):**
- Add `grant_type=refresh_token` branch to `token.ts`. SELECT FOR UPDATE inside tx.
- Add `POST /oauth/revoke` endpoint.
- Update `metadata.ts`: advertise `refresh_token` in `grant_types_supported`; add `revocation_endpoint`.
- Add inline PostHog `getClient()` pattern matching `track.ts` for these three events:
  - `oauth_refresh_succeeded`
  - `oauth_refresh_replay`
  - `oauth_refresh_expired`
  - `oauth_token_revoked`
- Access TTL still at 24h.

**PR3 — Drop access TTL to 1h:**
- Change `ACCESS_TOKEN_TTL_MS` constant from `24 * 60 * 60 * 1000` to `60 * 60 * 1000`.
- Update the issuance test to assert `expires_in: 3600`.
- Only after observing in prod that PR2 refresh flows succeed cleanly for at least 7 days across the active client base.

## Observability

PostHog events (new):

- `oauth_refresh_succeeded` — `distinctId: userId`, `clientId`, `familyId`. Fires on successful rotation.
- `oauth_refresh_replay` — `distinctId: userId`, `clientId`, `familyId`. Fires when revoked token is presented. **Investigate every occurrence.**
- `oauth_refresh_expired` — `distinctId: userId`, `clientId`. Fires when a refresh token is presented past its TTL.
- `oauth_token_revoked` — `distinctId: userId`, `clientId`, `familyId`. Fires on RFC 7009 revoke.

`distinctId` is the raw `userId` (UUID) throughout, matching the existing convention in `apps/gateway/src/gateway/track.ts` (`distinctId: props.userId`). No hashing — the UUID is itself opaque and internal-only.

Database queries for ops (add to `.claude/skills/db-query/SKILL.md` recipes):

- "How many refresh tokens issued in last 24h?"
- "How many active (non-revoked, non-expired) refresh-token families per user?"
- "Any users with more than 10 active families?" (suggests a client that re-auths instead of refreshing — bug signal)
- "Recent revoked families (potential replay attacks)"

## Test Infrastructure

The gateway currently has only pure-unit tests (`vi.fn()` mocks of injected functions — see `apps/gateway/src/gateway/usage/write.test.ts`). The OAuth refresh logic depends on real Postgres semantics: `SELECT ... FOR UPDATE` row locking, transaction isolation, and the actual schema. Mocking the Drizzle client would test the call shape but not the locking — exactly the bug class this spec is designed to prevent.

**Decision:** introduce `testcontainers` for these tests. Spin a real Postgres container per vitest worker (cached as a module-level singleton inside the harness), run the existing Drizzle migrations against it, expose a `getTestDb()` helper.

Justification over alternatives:
- **`pg-mem`**: faster but does not implement `SELECT ... FOR UPDATE`, transaction isolation levels, or every PG-ism Drizzle relies on. Semantic gap is the bug we are trying to prevent.
- **Shared local dev container**: works locally but couples tests to the dev environment, doesn't run in CI cleanly.
- **Mock Drizzle**: tests the call shape, not the locking. Race tests become impossible.

Cost: ~3s container startup per vitest worker (not per test file — the singleton amortizes startup across tests), plus a transitive `testcontainers` dev dep. Acceptable for a security-critical surface.

## Existing Tokens

Live 24h access tokens are not affected. They continue to work until their natural expiry. After PR1 ships, every new authorization-code grant issues both an access token and a refresh token. After PR2 ships, clients can begin refreshing. After PR3 ships, new access tokens drop to 1h. There is no migration step to retroactively issue refresh tokens to currently-active sessions; those sessions will re-auth once on their next 24h expiry, which is the normal current behavior.

## Open Questions

1. **Sliding refresh-token TTL?** RFC allows extending the refresh-token expiry on each rotation. v1 keeps a fixed 60d window from initial issuance. Sliding makes idle clients durable but lets a stolen token live indefinitely as long as it is used. v1 fixed-TTL is the safer default.
2. **Dashboard session cookie**, currently 24h, is out of scope. Should it follow the same pattern in a later spec? Probably yes, but a sliding cookie session is simpler and more standard for first-party web UIs than RT rotation.
3. **Admin revoke UI**? Out of scope for v1. Until then, support can run SQL via the `db-query` skill.

## Approval

Design approved 2026-05-17. Next step: implementation plan at `docs/superpowers/plans/2026-05-17-oauth-refresh-tokens.md`.
