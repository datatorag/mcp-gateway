# OAuth Refresh Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OAuth 2.1 refresh-token support to the DataToRAG MCP gateway so Claude Desktop / Claude Code can refresh silently and users stop needing to re-authorize every 24h.

**Architecture:** New `oauth_refresh_tokens` table storing `sha256(token)` (raw tokens never persisted). Token endpoint gains a `grant_type=refresh_token` branch with one-tx `SELECT ... FOR UPDATE` lookup, rotation, and family-revoke on replay. New `POST /oauth/revoke` endpoint per RFC 7009. Metadata advertises both. Rollout in three sequential PRs — schema+issuance, full refresh + revocation + metadata atomic, then access-TTL drop. Tests use `testcontainers` against a real Postgres because the race-protection logic depends on PG-specific locking semantics that mocks cannot represent.

**Tech Stack:** Postgres 16, Drizzle ORM, drizzle-kit, Node.js (Express), Vitest, testcontainers (new), posthog-node (already in deps).

**Spec:** `docs/superpowers/specs/2026-05-17-oauth-refresh-tokens-design.md`

---

## File Structure

**Modified:**
- `apps/gateway/package.json` — add `@testcontainers/postgresql` devDep (Task 0)
- `packages/db/src/schema/oauth.ts` — add `oauthRefreshTokens` table export
- `packages/db/src/schema/index.ts` — re-export `oauthRefreshTokens`
- `apps/gateway/src/gateway/oauth/token.ts` — issue refresh token in authorization_code branch; add new refresh_token branch
- `apps/gateway/src/gateway/oauth/metadata.ts` — advertise refresh_token; add revocation_endpoint (PR2)
- `apps/gateway/src/gateway/oauth/register.ts` — default grant_types to include refresh_token (PR1)
- `apps/gateway/src/lib/analytics.ts` — add four event constants
- `apps/gateway/server.ts` — wire `createRevokeRouter` (PR2)

**Created:**
- `packages/db/drizzle/0002_*.sql` — auto-generated migration adding `oauth_refresh_tokens`
- `apps/gateway/src/test-utils/db.ts` — `getTestDb()` / `insertTestUser()` via testcontainers (Task 0)
- `apps/gateway/src/gateway/oauth/__tests__/token-issuance.test.ts` — Task 2
- `apps/gateway/src/gateway/oauth/__tests__/token-refresh.test.ts` — Task 4
- `apps/gateway/src/gateway/oauth/revoke.ts` — Task 5
- `apps/gateway/src/gateway/oauth/__tests__/revoke.test.ts` — Task 5

---

## Task 0: Set up Postgres integration test harness (PR1)

**Files:**
- Modify: `apps/gateway/package.json`
- Create: `apps/gateway/src/test-utils/db.ts`
- Create: `apps/gateway/vitest.config.ts` (only if a config doesn't already exist; otherwise add `testTimeout` to existing one)

Why this task exists: existing tests in the gateway are all pure unit tests with `vi.fn()` mocks (see `apps/gateway/src/gateway/usage/write.test.ts`). The refresh-token logic depends on real PG semantics (`SELECT ... FOR UPDATE`, transaction isolation) that mocks cannot represent. This task creates the first DB-backed test harness.

- [ ] **Step 1: Add testcontainers dev dep**

```bash
pnpm --filter @datatorag-mcp/gateway add -D @testcontainers/postgresql testcontainers
```

Expected: `@testcontainers/postgresql` and `testcontainers` appear under `devDependencies` in `apps/gateway/package.json`.

- [ ] **Step 2: Set vitest test timeout to allow container startup**

If `apps/gateway/vitest.config.ts` exists, add `test.testTimeout: 30_000` and `test.hookTimeout: 60_000`. If it does not exist, create it:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
```

- [ ] **Step 3: Create the test harness**

Create `apps/gateway/src/test-utils/db.ts`:

```typescript
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as schema from "@datatorag-mcp/db";

type TestDb = NodePgDatabase<typeof schema>;

let container: StartedPostgreSqlContainer | null = null;
let pool: Pool | null = null;
let db: TestDb | null = null;

/**
 * Start a Postgres container (cached across tests in the same vitest worker),
 * run all Drizzle migrations, and return a Drizzle client.
 */
export async function getTestDb(): Promise<TestDb> {
  if (db) return db;

  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("datatoragmcp_test")
    .withUsername("datatoragmcp")
    .withPassword("test")
    .start();

  pool = new Pool({
    host: container.getHost(),
    port: container.getPort(),
    database: container.getDatabase(),
    user: container.getUsername(),
    password: container.getPassword(),
  });

  db = drizzle(pool, { schema });

  const migrationsFolder = path.resolve(
    __dirname,
    "../../../../packages/db/drizzle"
  );
  await migrate(db, { migrationsFolder });

  return db;
}

export async function stopTestDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
  if (container) {
    await container.stop();
    container = null;
  }
  db = null;
}

/**
 * Insert a fresh test user and return its id. Each call yields a unique user.
 */
export async function insertTestUser(testDb: TestDb): Promise<string> {
  const id = randomUUID();
  await testDb.insert(schema.users).values({
    id,
    email: `test-${id}@example.com`,
    emailVerified: true,
  });
  return id;
}
```

If the project does not yet export `users` from `@datatorag-mcp/db`, verify the actual schema entry-point and adjust the import accordingly.

- [ ] **Step 4: Smoke test the harness**

Create a temporary smoke test `apps/gateway/src/test-utils/db.smoke.test.ts`:

```typescript
import { afterAll, describe, expect, it } from "vitest";
import { getTestDb, insertTestUser, stopTestDb } from "./db";

afterAll(async () => {
  await stopTestDb();
});

describe("test harness smoke", () => {
  it("starts a container and runs migrations", async () => {
    const db = await getTestDb();
    const userId = await insertTestUser(db);
    expect(userId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
```

Run:

```bash
pnpm --filter @datatorag-mcp/gateway test test-utils/db.smoke
```

Expected: PASS. Container starts, migrations run, user inserts. If the test cannot find Docker, ensure Docker Desktop is running.

- [ ] **Step 5: Delete the smoke test**

```bash
rm apps/gateway/src/test-utils/db.smoke.test.ts
```

The smoke test was a one-shot verification. The real OAuth tests in subsequent tasks will exercise the harness.

- [ ] **Step 6: Commit**

```bash
git add apps/gateway/package.json apps/gateway/vitest.config.ts apps/gateway/src/test-utils/db.ts
git commit -m "Add Postgres integration test harness via testcontainers"
```

---

## PR 1 — Schema and Issuance

After PR1 is live on prod, every new authorization-code grant returns a refresh token, but clients still cannot use it (no refresh branch yet). Metadata is **not** updated in PR1 — clients see no advertised refresh_token grant. PR1 is invisible to clients.

### Task 1: Add `oauth_refresh_tokens` schema with `token_hash`

**Files:**
- Modify: `packages/db/src/schema/oauth.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/drizzle/0002_*.sql` (via drizzle-kit generate)

- [ ] **Step 1: Append schema definition to `oauth.ts`**

In `packages/db/src/schema/oauth.ts`, update the top-level drizzle import to include `index`:

```typescript
import { pgTable, text, timestamp, uuid, jsonb, index } from "drizzle-orm/pg-core";
```

Then append after the existing `oauthAccessTokens` table:

```typescript
// Refresh tokens (RFC 6749 + OAuth 2.1)
// Stored as sha256(rawToken). One-time-use with rotation; presenting a revoked
// token revokes the entire familyId.
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

- [ ] **Step 2: Re-export from index**

Edit `packages/db/src/schema/index.ts`. Add (alongside existing `oauthClients`, `oauthAuthorizationCodes`, `oauthAccessTokens` exports):

```typescript
export { oauthRefreshTokens } from "./oauth";
```

- [ ] **Step 3: Generate migration**

```bash
pnpm --filter @datatorag-mcp/db db:generate
```

Expected: a new file `packages/db/drizzle/0002_<random>.sql` containing `CREATE TABLE "oauth_refresh_tokens"` plus the two index statements. Inspect the SQL to confirm.

- [ ] **Step 4: Apply migration locally**

```bash
docker ps --filter 'name=postgres' --format '{{.Names}}'
pnpm --filter @datatorag-mcp/db db:migrate
```

Then verify:

```bash
docker exec <container> psql -U datatoragmcp -d datatoragmcp -c "\d oauth_refresh_tokens"
```

Expected: all columns from Step 1 plus two indexes, and `token_hash` column shows `text`, `not null`, with the unique index.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/oauth.ts packages/db/src/schema/index.ts packages/db/drizzle/0002_*.sql
git commit -m "Add oauth_refresh_tokens table (sha256-hashed) for refresh-grant support"
```

---

### Task 2: Issue hashed refresh token in authorization_code grant

**Files:**
- Modify: `apps/gateway/src/gateway/oauth/token.ts` (imports + issuance block)
- Test: `apps/gateway/src/gateway/oauth/__tests__/token-issuance.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/gateway/src/gateway/oauth/__tests__/token-issuance.test.ts`:

```typescript
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import express from "express";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTokenRouter } from "../token";
import { getTestDb, insertTestUser, stopTestDb } from "../../../test-utils/db";
import { oauthAuthorizationCodes, oauthRefreshTokens } from "@datatorag-mcp/db";

afterAll(async () => {
  await stopTestDb();
});

describe("POST /oauth/token (authorization_code grant)", () => {
  let app: express.Express;

  beforeEach(async () => {
    const db = await getTestDb();
    app = express();
    app.use(express.json());
    app.use(createTokenRouter(db));
  });

  it("issues access_token and refresh_token; stores only the hash", async () => {
    const db = await getTestDb();
    const userId = await insertTestUser(db);
    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    const code = "test-code-" + randomBytes(8).toString("hex");

    await db.insert(oauthAuthorizationCodes).values({
      code,
      clientId: "test-client",
      userId,
      redirectUri: "http://localhost/callback",
      codeChallenge,
      scope: "mcp:tools",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const res = await request(app)
      .post("/oauth/token")
      .send({
        grant_type: "authorization_code",
        code,
        redirect_uri: "http://localhost/callback",
        client_id: "test-client",
        code_verifier: codeVerifier,
      })
      .expect(200);

    expect(res.body.access_token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(res.body.refresh_token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(res.body.token_type).toBe("Bearer");
    expect(res.body.expires_in).toBe(86400); // PR1 still 24h; PR3 drops to 3600

    const expectedHash = createHash("sha256")
      .update(res.body.refresh_token)
      .digest("hex");

    const [row] = await db
      .select()
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.tokenHash, expectedHash));
    expect(row).toBeDefined();
    expect(row.userId).toBe(userId);
    expect(row.clientId).toBe("test-client");
    expect(row.familyId).toBeDefined();
    expect(row.replacedByTokenId).toBeNull();
    expect(row.expiresAt.getTime()).toBeGreaterThan(
      Date.now() + 59 * 24 * 60 * 60 * 1000
    );
  });

  it("never persists the raw refresh token", async () => {
    const db = await getTestDb();
    const userId = await insertTestUser(db);
    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    const code = "test-code-" + randomBytes(8).toString("hex");

    await db.insert(oauthAuthorizationCodes).values({
      code,
      clientId: "test-client",
      userId,
      redirectUri: "http://localhost/callback",
      codeChallenge,
      scope: "mcp:tools",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const res = await request(app)
      .post("/oauth/token")
      .send({
        grant_type: "authorization_code",
        code,
        redirect_uri: "http://localhost/callback",
        client_id: "test-client",
        code_verifier: codeVerifier,
      })
      .expect(200);

    const [row] = await db
      .select()
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.userId, userId));
    // The stored hash must never equal the raw token.
    expect(row.tokenHash).not.toBe(res.body.refresh_token);
    expect(row.tokenHash).toHaveLength(64); // sha256 hex
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @datatorag-mcp/gateway test token-issuance
```

Expected: FAIL — `refresh_token` is undefined in the response body.

- [ ] **Step 3: Implement issuance**

Edit `apps/gateway/src/gateway/oauth/token.ts`.

Change the top imports from:

```typescript
import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import { eq, and, isNull } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import {
  oauthAuthorizationCodes,
  oauthAccessTokens,
} from "@datatorag-mcp/db";
```

to:

```typescript
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Router } from "express";
import { eq, and, isNull } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import {
  oauthAuthorizationCodes,
  oauthAccessTokens,
  oauthRefreshTokens,
} from "@datatorag-mcp/db";

const ACCESS_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // PR3 drops this to 1h (60*60*1000)
const REFRESH_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
```

Replace the entire access-token issuance block (the `// Issue access token` comment through the `res.json({...})` call) with:

```typescript
    // Issue access + refresh tokens
    const accessToken = randomBytes(32).toString("base64url");
    const refreshToken = randomBytes(32).toString("base64url");
    const refreshTokenHash = sha256Hex(refreshToken);
    const now = Date.now();
    const accessTokenExpiresAt = new Date(now + ACCESS_TOKEN_TTL_MS);
    const refreshTokenExpiresAt = new Date(now + REFRESH_TOKEN_TTL_MS);
    const familyId = randomUUID();

    await db.transaction(async (tx) => {
      await tx.insert(oauthAccessTokens).values({
        token: accessToken,
        clientId: client_id,
        userId: authCode.userId,
        scope: authCode.scope,
        expiresAt: accessTokenExpiresAt,
      });
      await tx.insert(oauthRefreshTokens).values({
        tokenHash: refreshTokenHash,
        clientId: client_id,
        userId: authCode.userId,
        scope: authCode.scope,
        expiresAt: refreshTokenExpiresAt,
        familyId,
      });
    });

    res.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      refresh_token: refreshToken,
      scope: authCode.scope ?? "mcp:tools",
    });
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @datatorag-mcp/gateway test token-issuance
```

Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add apps/gateway/src/gateway/oauth/token.ts apps/gateway/src/gateway/oauth/__tests__/token-issuance.test.ts
git commit -m "Issue hashed refresh_token in authorization_code grant"
```

---

### Task 3: Update register default (do not touch metadata yet)

**Files:**
- Modify: `apps/gateway/src/gateway/oauth/register.ts:17`

Metadata stays unchanged in PR1. Advertising a grant the endpoint cannot service would be a spec lie. The register default is safe to change: it only affects what clients *may* request; the server's grant-type allowlist in `token.ts` is what actually gates behavior.

- [ ] **Step 1: Update register default**

In `apps/gateway/src/gateway/oauth/register.ts`, change line 17:

```typescript
      grant_types = ["authorization_code"],
```

to:

```typescript
      grant_types = ["authorization_code", "refresh_token"],
```

- [ ] **Step 2: Commit and ship PR1**

```bash
git add apps/gateway/src/gateway/oauth/register.ts
git commit -m "Default registered clients to authorization_code + refresh_token"
git push origin main
```

Then invoke the `deploy` skill to ship to prod.

Verification on prod:

```bash
# Issue a fresh auth code through the OAuth flow and inspect the response.
# It should contain refresh_token. Metadata should NOT yet advertise refresh_token.
curl -s https://datatorag.com/.well-known/oauth-authorization-server | grep grant_types
```

Expected: `"grant_types_supported": ["authorization_code"]` — unchanged in PR1.

---

## PR 2 — Refresh-Grant Branch, Revocation Endpoint, Metadata

Three tasks shipped together. After this PR, clients can refresh silently and explicitly revoke tokens, and metadata accurately advertises both. Access TTL still 24h — leaves a fallback if refresh has bugs.

### Task 4: Refresh-grant branch with SELECT FOR UPDATE and family-revoke

**Files:**
- Modify: `apps/gateway/src/gateway/oauth/token.ts`
- Modify: `apps/gateway/src/lib/analytics.ts`
- Test: `apps/gateway/src/gateway/oauth/__tests__/token-refresh.test.ts`

- [ ] **Step 1: Add event constants to analytics.ts**

In `apps/gateway/src/lib/analytics.ts`, add four constants to the `EVENTS` object:

```typescript
  OAUTH_REFRESH_SUCCEEDED: "oauth_refresh_succeeded",
  OAUTH_REFRESH_REPLAY: "oauth_refresh_replay",
  OAUTH_REFRESH_EXPIRED: "oauth_refresh_expired",
  OAUTH_TOKEN_REVOKED: "oauth_token_revoked",
```

Keep trailing-comma style consistent with existing entries.

- [ ] **Step 2: Write the failing tests**

Create `apps/gateway/src/gateway/oauth/__tests__/token-refresh.test.ts`:

```typescript
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import express from "express";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTokenRouter } from "../token";
import { getTestDb, insertTestUser, stopTestDb } from "../../../test-utils/db";
import { oauthRefreshTokens } from "@datatorag-mcp/db";

afterAll(async () => {
  await stopTestDb();
});

async function seedRefreshToken(opts: {
  userId: string;
  clientId?: string;
  expiresInMs?: number;
}): Promise<{ rawToken: string; familyId: string; clientId: string }> {
  const db = await getTestDb();
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const familyId = randomUUID();
  const clientId = opts.clientId ?? "test-client";
  const expiresInMs = opts.expiresInMs ?? 60 * 24 * 60 * 60 * 1000;
  await db.insert(oauthRefreshTokens).values({
    tokenHash,
    clientId,
    userId: opts.userId,
    scope: "mcp:tools",
    expiresAt: new Date(Date.now() + expiresInMs),
    familyId,
  });
  return { rawToken, familyId, clientId };
}

describe("POST /oauth/token (refresh_token grant)", () => {
  let app: express.Express;

  beforeEach(async () => {
    const db = await getTestDb();
    app = express();
    app.use(express.json());
    app.use(createTokenRouter(db));
  });

  it("rotates: returns new access + new refresh; old refresh is revoked and linked", async () => {
    const db = await getTestDb();
    const userId = await insertTestUser(db);
    const { rawToken: oldRt } = await seedRefreshToken({ userId });
    const oldHash = createHash("sha256").update(oldRt).digest("hex");

    const res = await request(app)
      .post("/oauth/token")
      .send({
        grant_type: "refresh_token",
        refresh_token: oldRt,
        client_id: "test-client",
      })
      .expect(200);

    expect(res.body.access_token).toBeDefined();
    expect(res.body.refresh_token).toBeDefined();
    expect(res.body.refresh_token).not.toBe(oldRt);

    const [oldRow] = await db
      .select()
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.tokenHash, oldHash));
    expect(oldRow.revokedAt).not.toBeNull();
    expect(oldRow.replacedByTokenId).not.toBeNull();
  });

  it("replay: presenting a revoked refresh token revokes the entire family", async () => {
    const db = await getTestDb();
    const userId = await insertTestUser(db);
    const { rawToken: rt1 } = await seedRefreshToken({ userId });

    const okRes = await request(app)
      .post("/oauth/token")
      .send({
        grant_type: "refresh_token",
        refresh_token: rt1,
        client_id: "test-client",
      })
      .expect(200);
    const rt2 = okRes.body.refresh_token;
    const rt2Hash = createHash("sha256").update(rt2).digest("hex");

    // Attacker replays rt1
    await request(app)
      .post("/oauth/token")
      .send({
        grant_type: "refresh_token",
        refresh_token: rt1,
        client_id: "test-client",
      })
      .expect(400);

    // rt2 (legit current) should now be revoked too
    const [rt2Row] = await db
      .select()
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.tokenHash, rt2Hash));
    expect(rt2Row.revokedAt).not.toBeNull();

    // And rt2 can no longer refresh
    await request(app)
      .post("/oauth/token")
      .send({
        grant_type: "refresh_token",
        refresh_token: rt2,
        client_id: "test-client",
      })
      .expect(400);
  });

  it("serializes parallel refreshes via SELECT FOR UPDATE (no family bifurcation)", async () => {
    const db = await getTestDb();
    const userId = await insertTestUser(db);
    const { rawToken: rt, familyId } = await seedRefreshToken({ userId });

    // Fire two concurrent refresh requests with the same token.
    const [res1, res2] = await Promise.all([
      request(app)
        .post("/oauth/token")
        .send({
          grant_type: "refresh_token",
          refresh_token: rt,
          client_id: "test-client",
        }),
      request(app)
        .post("/oauth/token")
        .send({
          grant_type: "refresh_token",
          refresh_token: rt,
          client_id: "test-client",
        }),
    ]);

    // Exactly one succeeds; the other goes to the replay branch.
    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 400]);

    // The family must have exactly one live (non-revoked, non-expired) token,
    // not two — confirms FOR UPDATE serialized the parallel rotations.
    const rows = await db
      .select()
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.familyId, familyId));
    const live = rows.filter(
      (r) => r.revokedAt === null && r.expiresAt > new Date()
    );
    // Replay revokes the family, so live count is 0 OR 1 — must NOT be 2.
    expect(live.length).toBeLessThanOrEqual(1);
  });

  it("rejects expired refresh tokens with invalid_grant", async () => {
    const db = await getTestDb();
    const userId = await insertTestUser(db);
    const { rawToken } = await seedRefreshToken({
      userId,
      expiresInMs: -1_000,
    });

    const res = await request(app)
      .post("/oauth/token")
      .send({
        grant_type: "refresh_token",
        refresh_token: rawToken,
        client_id: "test-client",
      })
      .expect(400);
    expect(res.body.error).toBe("invalid_grant");
  });

  it("rejects client_id mismatch with invalid_grant", async () => {
    const db = await getTestDb();
    const userId = await insertTestUser(db);
    const { rawToken } = await seedRefreshToken({
      userId,
      clientId: "client-a",
    });

    const res = await request(app)
      .post("/oauth/token")
      .send({
        grant_type: "refresh_token",
        refresh_token: rawToken,
        client_id: "client-b",
      })
      .expect(400);
    expect(res.body.error).toBe("invalid_grant");
  });

  it("rejects unknown refresh tokens with invalid_grant", async () => {
    await request(app)
      .post("/oauth/token")
      .send({
        grant_type: "refresh_token",
        refresh_token: "does-not-exist",
        client_id: "test-client",
      })
      .expect(400);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
pnpm --filter @datatorag-mcp/gateway test token-refresh
```

Expected: FAIL — `grant_type=refresh_token` currently returns `unsupported_grant_type`.

- [ ] **Step 4: Implement the refresh-grant branch**

Edit `apps/gateway/src/gateway/oauth/token.ts`. Inline the PostHog client setup matching the existing pattern in `apps/gateway/src/gateway/track.ts` — do **not** introduce a new `analytics-server.ts` lib file. The local pattern is the established convention.

At the top of the file, add:

```typescript
import { PostHog } from "posthog-node";
import { getEnv } from "@datatorag-mcp/config";
import { EVENTS } from "../../lib/analytics.js";

const POSTHOG_HOST = "https://us.i.posthog.com";
let posthogClient: PostHog | null = null;
function getPosthog(): PostHog | null {
  const apiKey = getEnv().POSTHOG_API_KEY;
  if (!apiKey) return null;
  if (!posthogClient) {
    posthogClient = new PostHog(apiKey, {
      host: POSTHOG_HOST,
      flushAt: 20,
      flushInterval: 10_000,
    });
  }
  return posthogClient;
}
```

(Verify these imports match `track.ts:1-2`. The pattern is intentionally duplicated to keep this file self-contained — the PostHog client is process-wide singleton so the second `new PostHog(...)` would be redundant in practice anyway.)

Then change the early grant-type rejection (currently lines 28-34):

```typescript
    if (grant_type !== "authorization_code") {
      res.status(400).json({
        error: "unsupported_grant_type",
        error_description: "Only authorization_code grant is supported",
      });
      return;
    }
```

to:

```typescript
    if (grant_type === "refresh_token") {
      await handleRefreshGrant(db, req, res);
      return;
    }

    if (grant_type !== "authorization_code") {
      res.status(400).json({
        error: "unsupported_grant_type",
        error_description: "Supported grants: authorization_code, refresh_token",
      });
      return;
    }
```

Add the `handleRefreshGrant` function. Place it as a file-level function (outside `createTokenRouter`) so it stays testable in isolation:

```typescript
async function handleRefreshGrant(
  db: Database,
  req: import("express").Request,
  res: import("express").Response
): Promise<void> {
  const { refresh_token, client_id } = req.body ?? {};

  if (!refresh_token || !client_id) {
    res.status(400).json({
      error: "invalid_request",
      error_description: "refresh_token and client_id are required",
    });
    return;
  }

  const hash = sha256Hex(refresh_token);

  try {
    const result = await db.transaction(async (tx) => {
      // SELECT ... FOR UPDATE — serialize parallel refreshes on the same token.
      const [row] = await tx
        .select()
        .from(oauthRefreshTokens)
        .where(eq(oauthRefreshTokens.tokenHash, hash))
        .for("update")
        .limit(1);

      if (!row) {
        return { kind: "unknown" as const };
      }
      if (row.clientId !== client_id) {
        return { kind: "client_mismatch" as const, row };
      }
      if (row.expiresAt < new Date()) {
        return { kind: "expired" as const, row };
      }
      if (row.revokedAt) {
        // Replay — revoke the entire live family.
        await tx
          .update(oauthRefreshTokens)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(oauthRefreshTokens.familyId, row.familyId),
              isNull(oauthRefreshTokens.revokedAt)
            )
          );
        return { kind: "replay" as const, row };
      }

      const newAccessToken = randomBytes(32).toString("base64url");
      const newRefreshToken = randomBytes(32).toString("base64url");
      const newRefreshHash = sha256Hex(newRefreshToken);
      const now = Date.now();

      await tx.insert(oauthAccessTokens).values({
        token: newAccessToken,
        clientId: row.clientId,
        userId: row.userId,
        scope: row.scope,
        expiresAt: new Date(now + ACCESS_TOKEN_TTL_MS),
      });
      const [inserted] = await tx
        .insert(oauthRefreshTokens)
        .values({
          tokenHash: newRefreshHash,
          clientId: row.clientId,
          userId: row.userId,
          scope: row.scope,
          expiresAt: new Date(now + REFRESH_TOKEN_TTL_MS),
          familyId: row.familyId,
        })
        .returning({ id: oauthRefreshTokens.id });
      await tx
        .update(oauthRefreshTokens)
        .set({ revokedAt: new Date(), replacedByTokenId: inserted.id })
        .where(eq(oauthRefreshTokens.id, row.id));

      return {
        kind: "ok" as const,
        row,
        newAccessToken,
        newRefreshToken,
        newRefreshId: inserted.id,
      };
    });

    const ph = getPosthog();

    switch (result.kind) {
      case "unknown":
      case "client_mismatch":
        res.status(400).json({
          error: "invalid_grant",
          error_description: "Unknown or mismatched refresh token",
        });
        return;
      case "expired":
        ph?.capture({
          distinctId: result.row.userId,
          event: EVENTS.OAUTH_REFRESH_EXPIRED,
          properties: { clientId: result.row.clientId },
        });
        res.status(400).json({
          error: "invalid_grant",
          error_description: "Refresh token expired",
        });
        return;
      case "replay":
        ph?.capture({
          distinctId: result.row.userId,
          event: EVENTS.OAUTH_REFRESH_REPLAY,
          properties: {
            clientId: result.row.clientId,
            familyId: result.row.familyId,
          },
        });
        res.status(400).json({
          error: "invalid_grant",
          error_description: "Refresh token revoked",
        });
        return;
      case "ok":
        ph?.capture({
          distinctId: result.row.userId,
          event: EVENTS.OAUTH_REFRESH_SUCCEEDED,
          properties: {
            clientId: result.row.clientId,
            familyId: result.row.familyId,
            newRefreshId: result.newRefreshId,
          },
        });
        res.json({
          access_token: result.newAccessToken,
          token_type: "Bearer",
          expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
          refresh_token: result.newRefreshToken,
          scope: result.row.scope ?? "mcp:tools",
        });
        return;
    }
  } catch (err) {
    // Surfacing the error to the client would leak DB internals — keep it generic.
    res.status(500).json({ error: "server_error" });
    throw err;
  }
}
```

Note: `db.transaction(...).for("update")` syntax in Drizzle node-postgres is `.for("update")` after the `.where()`. If the project's Drizzle version returns `.for()` as a no-op, verify in repl. (Drizzle ORM ≥0.29 supports it; project is on drizzle-kit ^0.30, which is paired with drizzle-orm in the same major.)

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @datatorag-mcp/gateway test token-refresh
```

Expected: PASS (all six cases including the race test).

- [ ] **Step 6: Build check**

```bash
pnpm --filter @datatorag-mcp/gateway build
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/gateway/src/gateway/oauth/token.ts apps/gateway/src/lib/analytics.ts apps/gateway/src/gateway/oauth/__tests__/token-refresh.test.ts
git commit -m "Implement refresh_token grant with SELECT FOR UPDATE rotation and replay revoke"
```

---

### Task 5: RFC 7009 token revocation endpoint

**Files:**
- Create: `apps/gateway/src/gateway/oauth/revoke.ts`
- Create: `apps/gateway/src/gateway/oauth/__tests__/revoke.test.ts`
- Modify: `apps/gateway/server.ts` (mount the new router)

- [ ] **Step 1: Write the failing tests**

Create `apps/gateway/src/gateway/oauth/__tests__/revoke.test.ts`:

```typescript
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import express from "express";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createRevokeRouter } from "../revoke";
import { getTestDb, insertTestUser, stopTestDb } from "../../../test-utils/db";
import { oauthRefreshTokens } from "@datatorag-mcp/db";

afterAll(async () => {
  await stopTestDb();
});

describe("POST /oauth/revoke", () => {
  let app: express.Express;

  beforeEach(async () => {
    const db = await getTestDb();
    app = express();
    app.use(express.json());
    app.use(createRevokeRouter(db));
  });

  it("revokes the token and all descendants in its family", async () => {
    const db = await getTestDb();
    const userId = await insertTestUser(db);
    const familyId = randomUUID();
    const tokens = [randomBytes(32).toString("base64url"), randomBytes(32).toString("base64url")];
    for (const t of tokens) {
      await db.insert(oauthRefreshTokens).values({
        tokenHash: createHash("sha256").update(t).digest("hex"),
        clientId: "test-client",
        userId,
        scope: "mcp:tools",
        expiresAt: new Date(Date.now() + 60_000_000),
        familyId,
      });
    }

    await request(app)
      .post("/oauth/revoke")
      .send({ token: tokens[0], client_id: "test-client" })
      .expect(200);

    const rows = await db
      .select()
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.familyId, familyId));
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
  });

  it("returns 200 even for unknown tokens (per RFC 7009 §2.2)", async () => {
    await request(app)
      .post("/oauth/revoke")
      .send({ token: "nope", client_id: "test-client" })
      .expect(200);
  });

  it("does not revoke if client_id mismatches (silently 200)", async () => {
    const db = await getTestDb();
    const userId = await insertTestUser(db);
    const raw = randomBytes(32).toString("base64url");
    await db.insert(oauthRefreshTokens).values({
      tokenHash: createHash("sha256").update(raw).digest("hex"),
      clientId: "client-a",
      userId,
      scope: "mcp:tools",
      expiresAt: new Date(Date.now() + 60_000_000),
      familyId: randomUUID(),
    });

    await request(app)
      .post("/oauth/revoke")
      .send({ token: raw, client_id: "client-b" })
      .expect(200);

    const [row] = await db
      .select()
      .from(oauthRefreshTokens)
      .where(
        eq(
          oauthRefreshTokens.tokenHash,
          createHash("sha256").update(raw).digest("hex")
        )
      );
    expect(row.revokedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Implement the revoke router**

Create `apps/gateway/src/gateway/oauth/revoke.ts`:

```typescript
import { createHash } from "node:crypto";
import { Router } from "express";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { oauthRefreshTokens } from "@datatorag-mcp/db";
import { PostHog } from "posthog-node";
import { getEnv } from "@datatorag-mcp/config";
import { EVENTS } from "../../lib/analytics.js";

const POSTHOG_HOST = "https://us.i.posthog.com";
let posthogClient: PostHog | null = null;
function getPosthog(): PostHog | null {
  const apiKey = getEnv().POSTHOG_API_KEY;
  if (!apiKey) return null;
  if (!posthogClient) {
    posthogClient = new PostHog(apiKey, {
      host: POSTHOG_HOST,
      flushAt: 20,
      flushInterval: 10_000,
    });
  }
  return posthogClient;
}

/**
 * RFC 7009 — OAuth 2.0 Token Revocation
 * Always returns 200 to avoid leaking token validity.
 */
export function createRevokeRouter(db: Database): Router {
  const router = Router();

  router.post("/oauth/revoke", async (req, res) => {
    const { token, client_id } = req.body ?? {};

    if (!token || !client_id) {
      // RFC: still 200, do not leak info to malformed callers.
      res.status(200).send();
      return;
    }

    const hash = createHash("sha256").update(token).digest("hex");

    await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(oauthRefreshTokens)
        .where(eq(oauthRefreshTokens.tokenHash, hash))
        .for("update")
        .limit(1);

      if (!row) return;
      if (row.clientId !== client_id) return;

      await tx
        .update(oauthRefreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(oauthRefreshTokens.familyId, row.familyId),
            isNull(oauthRefreshTokens.revokedAt)
          )
        );

      getPosthog()?.capture({
        distinctId: row.userId,
        event: EVENTS.OAUTH_TOKEN_REVOKED,
        properties: { clientId: row.clientId, familyId: row.familyId },
      });
    });

    res.status(200).send();
  });

  return router;
}
```

- [ ] **Step 3: Mount the router in `server.ts`**

In `apps/gateway/server.ts`, near the other oauth router mounts (look for `createTokenRouter`):

```typescript
import { createRevokeRouter } from "./src/gateway/oauth/revoke";
// ... existing mounts ...
app.use(createRevokeRouter(db));
```

Verify the import path matches the file's relative location in `server.ts`.

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @datatorag-mcp/gateway test revoke
```

Expected: PASS (all three cases).

- [ ] **Step 5: Commit**

```bash
git add apps/gateway/src/gateway/oauth/revoke.ts apps/gateway/src/gateway/oauth/__tests__/revoke.test.ts apps/gateway/server.ts
git commit -m "Add RFC 7009 token revocation endpoint with family-revoke"
```

---

### Task 6: Update metadata to advertise refresh_token and revocation_endpoint

**Files:**
- Modify: `apps/gateway/src/gateway/oauth/metadata.ts`

This is the **last** change in PR2. Metadata accurately reflects what the server now supports.

- [ ] **Step 1: Update metadata**

In `apps/gateway/src/gateway/oauth/metadata.ts`, change the response body from:

```typescript
    res.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      token_endpoint: `${baseUrl}/oauth/token`,
      registration_endpoint: `${baseUrl}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["mcp:tools"],
    });
```

to:

```typescript
    res.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      token_endpoint: `${baseUrl}/oauth/token`,
      registration_endpoint: `${baseUrl}/oauth/register`,
      revocation_endpoint: `${baseUrl}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      revocation_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["mcp:tools"],
    });
```

- [ ] **Step 2: Commit and ship PR2**

```bash
git add apps/gateway/src/gateway/oauth/metadata.ts
git commit -m "Advertise refresh_token grant and revocation_endpoint in metadata"
git push origin main
```

Then invoke the `deploy` skill.

Verification on prod:

```bash
curl -s https://datatorag.com/.well-known/oauth-authorization-server | python3 -m json.tool | grep -E "grant_types_supported|revocation_endpoint"
```

Expected: includes `"refresh_token"` and `"revocation_endpoint"`.

Watch PostHog for `oauth_refresh_succeeded` events firing as clients begin refreshing.

---

## PR 3 — Drop Access TTL to 1 hour

### Task 7: Reduce ACCESS_TOKEN_TTL_MS

**Files:**
- Modify: `apps/gateway/src/gateway/oauth/token.ts` (the `ACCESS_TOKEN_TTL_MS` constant added in Task 2)
- Modify: `apps/gateway/src/gateway/oauth/__tests__/token-issuance.test.ts`

Only proceed if PR2 telemetry has been clean for **at least 7 days**: `oauth_refresh_succeeded` counts climbing, `oauth_refresh_replay` count zero, no spike in `/mcp` 401 rate. If any check fails, stop and diagnose.

- [ ] **Step 1: Verify PR2 is healthy**

Check PostHog for the last 7 days:

- `oauth_refresh_succeeded` count > 0 across multiple days
- `oauth_refresh_replay` count = 0
- `oauth_refresh_expired` count is low and matches expected 60d-idle users

DB check:

```sql
SELECT
  count(*) FILTER (WHERE revoked_at IS NULL AND expires_at > now()) AS live,
  count(*) FILTER (WHERE revoked_at IS NOT NULL AND replaced_by_token_id IS NOT NULL) AS rotated
FROM oauth_refresh_tokens
WHERE created_at > now() - interval '7 days';
```

Expected: `rotated` > 0 across days — rotation is actually happening, not just issuance.

- [ ] **Step 2: Update the constant**

Edit `apps/gateway/src/gateway/oauth/token.ts`. Change:

```typescript
const ACCESS_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // PR3 drops this to 1h (60*60*1000)
```

to:

```typescript
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
```

- [ ] **Step 3: Update the issuance test**

In `apps/gateway/src/gateway/oauth/__tests__/token-issuance.test.ts`, change:

```typescript
    expect(res.body.expires_in).toBe(86400); // PR1 still 24h; PR3 drops to 3600
```

to:

```typescript
    expect(res.body.expires_in).toBe(3600);
```

- [ ] **Step 4: Run all tests**

```bash
pnpm --filter @datatorag-mcp/gateway test
```

Expected: PASS.

- [ ] **Step 5: Commit and ship PR3**

```bash
git add apps/gateway/src/gateway/oauth/token.ts apps/gateway/src/gateway/oauth/__tests__/token-issuance.test.ts
git commit -m "Drop OAuth access token TTL from 24h to 1h"
git push origin main
```

Invoke the `deploy` skill. Monitor PostHog for the next 24h:

- `oauth_refresh_succeeded` count should rise (~24× compared to before, since clients refresh hourly).
- Any drop in `tool_call` volume or spike in `/mcp` 401s signals a refresh bug — revert the constant.

---

## Post-Rollout

After all three PRs ship and prod is healthy:

- Add query recipes to `.claude/skills/db-query/SKILL.md` under "Common query recipes":
  - "Active refresh-token families per user"
  - "Refresh tokens issued in last 24h"
  - "Suspected replay attacks (oauth_refresh_replay events)"
  - "Tokens recently revoked via RFC 7009"
- Optional follow-up spec: extend revocation to access tokens (~5 LOC), add admin revoke UI, consider sliding refresh TTL.
