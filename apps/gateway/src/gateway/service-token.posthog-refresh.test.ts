/**
 * SCRUM-471: a PostHog refresh, for a client with no secret. PostHog does not
 * rotate this client's refresh token today; the refresh still takes the row
 * lock (`refreshRotatingToken`), so two callers refreshing at once present
 * the refresh token once, and a later rotation on PostHog's side cannot lose
 * one. Real Postgres, because the lock is the thing under test.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/google-revoke", () => ({ revokeGoogleToken: vi.fn(async () => true) }));

import { eq } from "drizzle-orm";
import { serviceConnections, type Database } from "@datatorag-mcp/db";
import { getTestDb, stopTestDb, insertTestUser, isDockerAvailable } from "../test-utils/db";
import { upsertServiceAccount } from "./connected-accounts";
import { refreshPostHogToken, revokeUpstream } from "./service-token";
import { sealedColumns } from "./token-crypto";

const TOKEN_URL = "https://us.posthog.com/oauth/token/";
const REVOKE_URL = "https://us.posthog.com/oauth/revoke/";
const CLIENT_ID = "https://gateway.example/auth/posthog/client.json";

/** PostHog's token endpoint, rotating here so the lock is what is tested: a
 * second presentation of a spent refresh token is refused. */
class FakePostHog {
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
      JSON.stringify({ access_token: `access-${this.generation}`, refresh_token: `refresh-${this.generation}`, expires_in: 604800 }),
      { status: 200 }
    );
  }
}

describe.skipIf(!isDockerAvailable())("SCRUM-471: refreshPostHogToken", () => {
  let db: Database;
  let posthog: FakePostHog;
  let revoked: Array<Record<string, string>>;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    db = await getTestDb();
  }, 120_000);
  afterAll(async () => {
    await stopTestDb();
  });

  beforeEach(() => {
    process.env.GATEWAY_BASE_URL = "https://gateway.example";
    delete process.env.POSTHOG_CONNECTOR_BASE_URL;
    posthog = new FakePostHog();
    revoked = [];
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        if (String(url) === TOKEN_URL) return posthog.handle(init ?? {});
        if (String(url) === REVOKE_URL) {
          revoked.push(Object.fromEntries(new URLSearchParams(String(init?.body))));
          return new Response("{}", { status: 200 });
        }
        return realFetch(url, init);
      })
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
      "posthog",
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

  it("refreshes with the client id and no secret, and stores the new pair and its expiry", async () => {
    const { connId, userId } = await connected();
    const before = Date.now();
    expect(await refreshPostHogToken(db, { id: connId, userId }, "refresh-1")).toEqual({ token: "access-2" });
    const row = await stored(connId);
    expect(row).toMatchObject({ access: "access-2", refresh: "refresh-2" });
    expect(row.expires!.getTime()).toBeGreaterThanOrEqual(before + 604800_000 - 1000);
    expect(posthog.calls).toEqual([
      { grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token: "refresh-1" },
    ]);
  });

  it("two refreshes at once present the refresh token once, and both callers get the same token", async () => {
    const { connId, userId } = await connected();
    const [a, b] = await Promise.all([
      refreshPostHogToken(db, { id: connId, userId }, "refresh-1"),
      refreshPostHogToken(db, { id: connId, userId }, "refresh-1"),
    ]);
    expect(posthog.calls).toHaveLength(1);
    expect(a).toEqual({ token: "access-2" });
    expect(b).toEqual({ token: "access-2" });
  });

  it("a refused refresh is a permanent failure, so the connection is marked for reconnect", async () => {
    const { connId, userId } = await connected();
    expect(await refreshPostHogToken(db, { id: connId, userId }, "refresh-stale")).toEqual({ token: "access-1" });
    posthog.generation = 99;
    expect(await refreshPostHogToken(db, { id: connId, userId }, "refresh-1")).toEqual({
      failure: { kind: "permanent", reason: "invalid_grant" },
    });
  });

  it("builds the client id from the config schema's base URL when none is set", async () => {
    // The schema defaults GATEWAY_BASE_URL, so an unset one is the default,
    // never a second fallback here (production always sets it).
    delete process.env.GATEWAY_BASE_URL;
    const { connId, userId } = await connected();
    await refreshPostHogToken(db, { id: connId, userId }, "refresh-1");
    expect(posthog.calls[0]?.client_id).toBe("http://localhost:8285/auth/posthog/client.json");
  });

  it("a disconnect revokes the refresh token, which outlives any access token", async () => {
    const row = { userId: "00000000-0000-4000-8000-000000000001", rowId: "00000000-0000-4000-8000-000000000002" };
    const sealed = sealedColumns("service_connections", row, { accessToken: "access-1", refreshToken: "refresh-1" });
    expect(await revokeUpstream("posthog", sealed, row)).toBe(true);
    expect(revoked).toEqual([{ token: "refresh-1", client_id: CLIENT_ID }]);
  });
});
