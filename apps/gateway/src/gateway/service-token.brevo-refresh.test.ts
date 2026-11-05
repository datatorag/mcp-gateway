/**
 * SCRUM-468: Brevo's access tokens last an hour, and a refresh may hand back
 * a new refresh token. The refresh takes the same row lock Notion's does
 * (`refreshRotatingToken`), so two callers refreshing at once present the
 * refresh token once. Real Postgres, because the lock is the thing under
 * test: a stub cannot block one transaction behind another.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/google-revoke", () => ({ revokeGoogleToken: vi.fn(async () => true) }));

import { eq } from "drizzle-orm";
import { serviceConnections, type Database } from "@datatorag-mcp/db";
import { getTestDb, stopTestDb, insertTestUser, isDockerAvailable } from "../test-utils/db";
import { upsertServiceAccount } from "./connected-accounts";
import { refreshBrevoToken } from "./connectors/brevo/tokens";
import { BREVO_TOKEN_URL } from "./connectors/brevo/oauth";

/** Brevo's token endpoint as its guide describes it: a new access token, and
 * a new refresh token that replaces the old. The old one is refused after. */
class FakeBrevo {
  generation = 1;
  calls: Array<Record<string, string>> = [];
  delayMs = 150;
  async handle(init: RequestInit): Promise<Response> {
    const body = Object.fromEntries(new URLSearchParams(String(init.body)));
    this.calls.push(body);
    await new Promise((r) => setTimeout(r, this.delayMs));
    if (body.grant_type !== "refresh_token" || body.refresh_token !== `refresh-${this.generation}`) {
      return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    }
    this.generation += 1;
    return new Response(
      JSON.stringify({ access_token: `access-${this.generation}`, refresh_token: `refresh-${this.generation}`, expires_in: 3600 }),
      { status: 200 }
    );
  }
}

describe.skipIf(!isDockerAvailable())("SCRUM-468: refreshBrevoToken", () => {
  let db: Database;
  let brevo: FakeBrevo;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    db = await getTestDb();
  }, 120_000);
  afterAll(async () => {
    await stopTestDb();
  });

  beforeEach(() => {
    process.env.BREVO_OAUTH_CLIENT_ID = "brevo-cid";
    process.env.BREVO_OAUTH_CLIENT_SECRET = "brevo-secret";
    brevo = new FakeBrevo();
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => (String(url) === BREVO_TOKEN_URL ? brevo.handle(init ?? {}) : realFetch(url, init)))
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...savedEnv };
  });

  async function connected() {
    const userId = await insertTestUser(db);
    await upsertServiceAccount(
      db,
      userId,
      "brevo",
      "owner@example.com",
      { access_token: "access-1", refresh_token: "refresh-1" },
      null,
      new Date(Date.now() - 1000)
    );
    const [row] = await db.select({ id: serviceConnections.id }).from(serviceConnections).where(eq(serviceConnections.userId, userId));
    return { userId, connId: row.id };
  }

  async function stored(connId: string) {
    const [row] = await db
      .select({ access: serviceConnections.accessToken, refresh: serviceConnections.refreshToken, expires: serviceConnections.tokenExpiresAt })
      .from(serviceConnections)
      .where(eq(serviceConnections.id, connId));
    return row;
  }

  it("refreshes with the client secret in the form body, stores the new pair and the hour's expiry", async () => {
    const { connId, userId } = await connected();
    const before = Date.now();
    expect(await refreshBrevoToken(db, { id: connId, userId }, "refresh-1")).toEqual({ token: "access-2" });
    const row = await stored(connId);
    expect(row).toMatchObject({ access: "access-2", refresh: "refresh-2" });
    expect(row.expires!.getTime()).toBeGreaterThanOrEqual(before + 3600_000 - 1000);
    expect(brevo.calls).toEqual([
      { grant_type: "refresh_token", client_id: "brevo-cid", client_secret: "brevo-secret", refresh_token: "refresh-1" },
    ]);
  });

  it("two refreshes at once present the refresh token once, and both callers get the same token", async () => {
    const { connId, userId } = await connected();
    const [a, b] = await Promise.all([
      refreshBrevoToken(db, { id: connId, userId }, "refresh-1"),
      refreshBrevoToken(db, { id: connId, userId }, "refresh-1"),
    ]);
    expect(brevo.calls).toHaveLength(1);
    expect(a).toEqual({ token: "access-2" });
    expect(b).toEqual({ token: "access-2" });
  });

  it("a refused refresh is a permanent failure, so the connection is marked for reconnect", async () => {
    const { connId, userId } = await connected();
    expect(await refreshBrevoToken(db, { id: connId, userId }, "refresh-stale")).toEqual({ token: "access-1" });
    brevo.generation = 99;
    expect(await refreshBrevoToken(db, { id: connId, userId }, "refresh-1")).toEqual({
      failure: { kind: "permanent", reason: "invalid_grant" },
    });
  });

  it("does nothing without the app's credentials", async () => {
    delete process.env.BREVO_OAUTH_CLIENT_SECRET;
    const { connId, userId } = await connected();
    expect(await refreshBrevoToken(db, { id: connId, userId }, "refresh-1")).toBeNull();
    expect(brevo.calls).toHaveLength(0);
  });
});
