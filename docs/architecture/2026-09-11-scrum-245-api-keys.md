# A machine credential that does not rotate (SCRUM-245)

Date: 2026-09-11

## Problem

The gateway's OAuth refresh tokens are single-use: every refresh rotates
the token, and presenting a spent one revokes the whole family. That is
the right property for an interactive client that persists what it is
handed. It is fatal for a CLI that loads a credential file and never
writes it back: the first refresh spends the stored token, and every
call after it fails with a revoked refresh token. Re-authenticating buys
one access-token lifetime, about a day, then the same death. The smoke
harness ran for a week under that description and was recorded as "not
re-authed" when the credential path itself was the defect.

## Decision

An API key, minted by the account holder from the dashboard:

- scoped to one user, at most ten live per user;
- shown once at minting, stored only as a hash and a short prefix;
- revocable from the same page, effective on the next request;
- accepted as a bearer on `/mcp` exactly like an access token, with no
  refresh and no rotation.

The `api_keys` table and the auth package's key helpers already existed
with no consumer; this change gives them one. Production has had the
table since the early days, made by hand; a journaled, idempotent
migration now creates it where it is missing, so a fresh environment has
it too.

## The alternative, rejected

Letting a marked client reuse a refresh token inside a grace window
keeps rotation semantics the client cannot honour and makes liveness
depend on a clock race between the client's retry and the window. It is
also weaker: a token that is reusable for a while is a token that is
reusable by whoever copies it in that while. A key is honest about being
long-lived, and the honest answer is what revocation is for.

## Rails

- The raw key never appears in a log line or a telemetry property. It is
  hashed on arrival; the failure event carries a reason and an owner, not
  the credential; and the error-message redaction masks the key's shape
  wherever it might be quoted.
- `mcp_session_initialized` carries `auth_kind`, `api_key` or `oauth`,
  so machine sessions separate from interactive ones without a second
  event. Tool calls a key makes carry `client_id: api-key`, the way
  dashboard sessions carry `web`.
- Nothing else changes with the credential: the same MCP server, the
  same tool classification, the same approval policy, the same metering.
  A key is a way in, not a different kind of user.

## Verification

- `bearer-auth.test.ts`: a key authenticates with its own client id and
  auth kind; a revoked key is refused and names its owner; an expired key
  and a never-minted key are refused; an OAuth bearer resolves exactly as
  before; nothing the module does writes the key to a console; minting
  stores a hash and a prefix and returns the raw value once; listing
  carries no hash; revocation is guarded on the owner and on liveness.
- `bearer-auth.mcp.test.ts`: through a real client and server pair, the
  identity a key resolves to lists tools and calls one, and the call
  attributes to the key's client id.
- `redact.test.ts`: a quoted key is masked, whole or truncated.
- `mcp-analytics.test.ts`: the session event carries `auth_kind` both
  ways.
- The smoke harness and the triage verifier are wired to a key after the
  deploy, by the operator, not here.
