import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { oauthAccessTokens } from "@datatorag-mcp/db";
import type { Database } from "@datatorag-mcp/db";
import {
  getTestDb,
  stopTestDb,
  insertTestUser,
  isDockerAvailable,
} from "@/test-utils/db";

// This route's non-"web" token query must only count LIVE tokens (not revoked,
// not expired) — see route.test.ts for the mocked-db happy-path coverage.
// That mock stub ignores whatever `.where(...)` conditions the route builds,
// so it can't catch a regression here (a revoked/expired row simply wouldn't
// come back from real Postgres, but the stub ignores the query entirely).
// Per .claude/skills/gateway-dev's testing-patterns guidance — "reach for the
// testcontainers helper... you don't trust a stub to represent [real SQL]" —
// this exercises the real WHERE clause against a real Postgres instance.
//
// Docker-optional: this file spins up a real Postgres testcontainer, so it
// must not hard-fail `pnpm vitest run` on a machine/CI runner without a
// reachable Docker daemon. `dockerAvailable` is probed synchronously at
// import time (cheap — a local `docker info` call) and gates the whole
// describe block below, mirroring the env-gating convention in
// apps/gateway/e2e/mcp.e2e.test.ts (`describe.runIf(!!process.env.MCP_E2E_URL)`).
// Critically, the `@/lib/db` mock factory must never call getTestDb() at
// module-import time — that would start a container (or throw) before the
// skip check has a chance to apply. Instead the factory returns a getter
// that reads `mockDb`, a module-scope holder populated by beforeAll *inside*
// the gated describe block — so when Docker is unavailable and the block is
// skipped, beforeAll never runs, getTestDb() is never called, and no
// container is ever started.
const dockerAvailable = isDockerAvailable();

const sessionUserId = vi.fn<() => Promise<string | null>>();
vi.mock("@/lib/session", () => ({
  getSessionUserId: () => sessionUserId(),
}));

// Populated by beforeAll (inside the gated describe block below) — never at
// import time. The getter is only invoked once a test calls GET(), which
// only happens after beforeAll has run, which only happens when
// dockerAvailable is true (describe.skipIf prevents the block, including
// beforeAll, from running at all otherwise).
let mockDb: Database | undefined;

vi.mock("@/lib/db", () => ({
  get db() {
    if (!mockDb) {
      throw new Error(
        "test db not initialized — this should be unreachable: the route " +
          "should only be invoked from within the Docker-gated describe " +
          "block, after beforeAll has set up the testcontainer."
      );
    }
    return mockDb;
  },
}));

const { GET } = await import("./route");

let testDb: Database;

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

describe.skipIf(!dockerAvailable)(
  "GET /api/setup/status — token liveness (real Postgres)",
  () => {
    beforeAll(async () => {
      testDb = await getTestDb();
      mockDb = testDb;
    }, 120_000);

    afterAll(async () => {
      await stopTestDb();
      mockDb = undefined;
    });

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
  }
);
