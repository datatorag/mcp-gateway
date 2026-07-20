import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { oauthAccessTokens } from "@datatorag-mcp/db";
import type { Database } from "@datatorag-mcp/db";
import { getTestDb, stopTestDb, insertTestUser } from "@/test-utils/db";

// This route's non-"web" token query must only count LIVE tokens (not revoked,
// not expired) — see route.test.ts for the mocked-db happy-path coverage.
// That mock stub ignores whatever `.where(...)` conditions the route builds,
// so it can't catch a regression here (a revoked/expired row simply wouldn't
// come back from real Postgres, but the stub ignores the query entirely).
// Per .claude/skills/gateway-dev's testing-patterns guidance — "reach for the
// testcontainers helper... you don't trust a stub to represent [real SQL]" —
// this exercises the real WHERE clause against a real Postgres instance.

const sessionUserId = vi.fn<() => Promise<string | null>>();
vi.mock("@/lib/session", () => ({
  getSessionUserId: () => sessionUserId(),
}));

vi.mock("@/lib/db", async () => {
  const { getTestDb } = await import("@/test-utils/db");
  return { db: await getTestDb() };
});

const { GET } = await import("./route");

let testDb: Database;

beforeAll(async () => {
  testDb = await getTestDb();
}, 120_000);

afterAll(async () => {
  await stopTestDb();
});

const HOUR = 60 * 60 * 1000;

async function insertToken(opts: {
  userId: string;
  clientId: string;
  revokedAt?: Date | null;
  expiresAt: Date;
  createdAt?: Date;
}) {
  await testDb.insert(oauthAccessTokens).values({
    token: `test-token-${randomUUID()}`,
    clientId: opts.clientId,
    userId: opts.userId,
    revokedAt: opts.revokedAt ?? null,
    expiresAt: opts.expiresAt,
    createdAt: opts.createdAt ?? new Date(),
  });
}

describe("GET /api/setup/status — token liveness (real Postgres)", () => {
  it("does not count a revoked non-web token as connected", async () => {
    const userId = await insertTestUser(testDb);
    sessionUserId.mockResolvedValue(userId);
    await insertToken({
      userId,
      clientId: "claude-desktop",
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + HOUR),
    });

    const res = await GET();
    const body = await res.json();
    expect(body.agentConnected).toBe(false);
    expect(body.agentClientName).toBeNull();
    expect(body.agentConnectedAt).toBeNull();
  });

  it("does not count an expired non-web token as connected", async () => {
    const userId = await insertTestUser(testDb);
    sessionUserId.mockResolvedValue(userId);
    await insertToken({
      userId,
      clientId: "claude-desktop",
      revokedAt: null,
      expiresAt: new Date(Date.now() - HOUR),
    });

    const res = await GET();
    const body = await res.json();
    expect(body.agentConnected).toBe(false);
    expect(body.agentClientName).toBeNull();
    expect(body.agentConnectedAt).toBeNull();
  });

  it("counts a live (unrevoked, unexpired) non-web token as connected", async () => {
    const userId = await insertTestUser(testDb);
    sessionUserId.mockResolvedValue(userId);
    await insertToken({
      userId,
      clientId: "claude-desktop",
      revokedAt: null,
      expiresAt: new Date(Date.now() + HOUR),
    });

    const res = await GET();
    const body = await res.json();
    expect(body.agentConnected).toBe(true);
  });

  it("prefers a live older token over a revoked more-recent one", async () => {
    const userId = await insertTestUser(testDb);
    sessionUserId.mockResolvedValue(userId);
    const older = new Date(Date.now() - 2 * HOUR);
    const newer = new Date(Date.now() - HOUR);
    await insertToken({
      userId,
      clientId: "claude-desktop",
      revokedAt: null,
      expiresAt: new Date(Date.now() + HOUR),
      createdAt: older,
    });
    await insertToken({
      userId,
      clientId: "cursor",
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + HOUR),
      createdAt: newer,
    });

    const res = await GET();
    const body = await res.json();
    expect(body.agentConnected).toBe(true);
    expect(body.agentClientName).toBeNull(); // no matching oauth_clients row seeded
  });
});
