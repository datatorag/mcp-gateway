/**
 * SCRUM-442, release 2: provider tokens are read from the sealed columns,
 * opened only where they are handed on, and never read in plain text.
 *
 * Real Postgres: each case builds the rows a resolver or a refresh reads, so
 * what is proven is what the sealed columns serve, not what a stub returns.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/google-revoke", () => ({
  revokeGoogleToken: vi.fn(async () => true),
}));

import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { connectedAccounts, serviceConnections, type Database } from "@datatorag-mcp/db";
import { revokeGoogleToken } from "@/lib/google-revoke";
import { getTestDb, stopTestDb, insertTestUser, isDockerAvailable } from "../test-utils/db";
import { upsertServiceAccount } from "./connected-accounts";
import { refreshNotionToken, resolveServiceToken, revokeUpstream } from "./service-token";
import { sealToken, sealedColumns } from "./token-crypto";

describe.skipIf(!isDockerAvailable())("SCRUM-442: provider tokens are read sealed", () => {
  let db: Database;
  const savedEnv = { ...process.env };
  let fetchBodies: string[] = [];

  beforeAll(async () => {
    db = await getTestDb();
  }, 120_000);

  afterAll(async () => {
    await stopTestDb();
  });

  beforeEach(() => {
    fetchBodies = [];
    for (const [k, v] of Object.entries({
      GOOGLE_GWS_CLIENT_ID: "g-cid",
      GOOGLE_GWS_CLIENT_SECRET: "g-secret",
      ATLASSIAN_CLIENT_ID: "a-cid",
      ATLASSIAN_CLIENT_SECRET: "a-secret",
      NOTION_OAUTH_CLIENT_ID: "n-cid",
      NOTION_OAUTH_CLIENT_SECRET: "n-secret",
    })) {
      process.env[k] = v;
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env = { ...savedEnv };
  });

  function provider(body: Record<string, unknown>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL, init?: RequestInit) => {
        fetchBodies.push(String(init?.body));
        return new Response(JSON.stringify(body), { status: 200 });
      })
    );
  }

  const expired = () => new Date(Date.now() - 60_000);

  async function connect(service: string, tokens: { access_token: string; refresh_token?: string }, expiresAt: Date | null = null) {
    const userId = await insertTestUser(db);
    await upsertServiceAccount(db, userId, service, `${service}@example.com`, tokens, null, expiresAt);
    const [row] = await db
      .select({ id: serviceConnections.id })
      .from(serviceConnections)
      .where(eq(serviceConnections.userId, userId));
    return { userId, rowId: row.id };
  }

  /** Make a row's plain columns disagree with its sealed ones, so a read of
   * the wrong column shows. */
  async function scramblePlain(rowId: string) {
    await db
      .update(serviceConnections)
      .set({ accessToken: "plain-not-served", refreshToken: "plain-refresh-not-used" })
      .where(eq(serviceConnections.id, rowId));
  }

  describe("resolveServiceToken", () => {
    it("serves the opened sealed token through the default account", async () => {
      const { userId, rowId } = await connect("google-workspace", { access_token: "at-1", refresh_token: "rt-1" });
      await scramblePlain(rowId);
      expect(await resolveServiceToken(db, userId, "google-workspace")).toMatchObject({ token: "at-1" });
    });

    it("serves it when an account is named", async () => {
      const { userId, rowId } = await connect("atlassian", { access_token: "at-1" });
      await scramblePlain(rowId);
      expect(await resolveServiceToken(db, userId, "atlassian", "atlassian@example.com")).toMatchObject({
        token: "at-1",
      });
    });

    it("serves it on the legacy path, a row with no connected account", async () => {
      const userId = await insertTestUser(db);
      const id = randomUUID();
      await db.insert(serviceConnections).values({
        id,
        userId,
        service: "google-workspace",
        accessToken: "plain-not-served",
        ...sealedColumns("service_connections", { userId, rowId: id }, { accessToken: "at-legacy" }),
      });
      expect(await resolveServiceToken(db, userId, "google-workspace")).toMatchObject({ token: "at-legacy" });
    });

    it("refuses a row with no sealed token rather than serve its plain one", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { userId, rowId } = await connect("google-workspace", { access_token: "at-1" });
      await db.update(serviceConnections).set({ accessTokenSealed: null }).where(eq(serviceConnections.id, rowId));
      expect(await resolveServiceToken(db, userId, "google-workspace")).toBeNull();
      expect(warn).toHaveBeenCalledWith("[service-token] google-workspace connection has no sealed token");
    });

    it("refuses, without throwing, a value sealed under a key no longer listed", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const saved = process.env.CONNECTION_TOKEN_KEYS;
      process.env.CONNECTION_TOKEN_KEYS = `gone:${randomBytes(32).toString("base64")}`;
      const { userId } = await connect("google-workspace", { access_token: "at-1" });
      process.env.CONNECTION_TOKEN_KEYS = saved;
      await expect(resolveServiceToken(db, userId, "google-workspace")).resolves.toBeNull();
      expect(warn).toHaveBeenCalledWith("[service-token] service_connections.access_token could not be opened");
      for (const call of warn.mock.calls) expect(String(call)).not.toContain("at-1");
    });

    it("refuses a value moved from another user's row", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const a = await connect("google-workspace", { access_token: "at-a" });
      const b = await connect("google-workspace", { access_token: "at-b" });
      const [fromA] = await db
        .select({ s: serviceConnections.accessTokenSealed })
        .from(serviceConnections)
        .where(eq(serviceConnections.id, a.rowId));
      await db.update(serviceConnections).set({ accessTokenSealed: fromA.s }).where(eq(serviceConnections.id, b.rowId));
      expect(await resolveServiceToken(db, b.userId, "google-workspace")).toBeNull();
    });
  });

  describe("refresh", () => {
    for (const [service, body] of [
      ["google-workspace", { access_token: "at-2", expires_in: 3600 }],
      ["atlassian", { access_token: "at-2", refresh_token: "rt-2", expires_in: 3600 }],
      ["notion", { access_token: "at-2", refresh_token: "rt-2" }],
    ] as const) {
      it(`${service} sends the provider the opened refresh token`, async () => {
        const { userId, rowId } = await connect(service, { access_token: "at-1", refresh_token: "rt-1" }, expired());
        await scramblePlain(rowId);
        provider(body);
        expect(await resolveServiceToken(db, userId, service)).toMatchObject({ token: "at-2" });
        expect(fetchBodies).toHaveLength(1);
        expect(fetchBodies[0]).toContain("rt-1");
        expect(fetchBodies[0]).not.toContain("plain-refresh-not-used");
      });
    }

    it("Notion compares the opened stored token, so a token sealed again still refreshes", async () => {
      const { userId, rowId } = await connect("notion", { access_token: "at-1", refresh_token: "rt-1" });
      // The same refresh token, sealed again: equal as a token, unequal as text.
      await db
        .update(serviceConnections)
        .set(sealedColumns("service_connections", { userId, rowId }, { refreshToken: "rt-1" }))
        .where(eq(serviceConnections.id, rowId));
      provider({ access_token: "at-2", refresh_token: "rt-2" });
      expect(await refreshNotionToken(db, { id: rowId, userId }, "rt-1")).toBe("at-2");
      expect(fetchBodies).toHaveLength(1);
    });

    it("Notion hands back the stored, opened access token when another caller already rotated", async () => {
      const { userId, rowId } = await connect("notion", { access_token: "at-1", refresh_token: "rt-1" });
      await scramblePlain(rowId);
      provider({ access_token: "never", refresh_token: "never" });
      expect(await refreshNotionToken(db, { id: rowId, userId }, "rt-old")).toBe("at-1");
      expect(fetchBodies).toHaveLength(0);
    });
  });

  describe("revoke", () => {
    it("opens the sealed tokens it is handed and sends the provider the token", async () => {
      const userId = await insertTestUser(db);
      const row = { userId, rowId: randomUUID() };
      const sealed = sealedColumns("service_connections", row, { accessToken: "at-1", refreshToken: "rt-1" });
      expect(await revokeUpstream("google-workspace", sealed, row)).toBe(true);
      expect(revokeGoogleToken).toHaveBeenCalledWith("rt-1");
    });

    it("sends nothing it cannot open", async () => {
      vi.mocked(revokeGoogleToken).mockClear();
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const row = { userId: "u", rowId: "r" };
      const sealed = { accessTokenSealed: sealToken("at-1", { table: "service_connections", column: "access_token", userId: "other", rowId: "r" }), refreshTokenSealed: null };
      expect(await revokeUpstream("google-workspace", sealed, row)).toBe(false);
      expect(revokeGoogleToken).not.toHaveBeenCalled();
    });

    it("a disconnect revokes with the opened token, read from the sealed columns", async () => {
      vi.mocked(revokeGoogleToken).mockClear();
      const { userId, rowId } = await connect("google-workspace", { access_token: "at-1", refresh_token: "rt-1" });
      await scramblePlain(rowId);
      const { disconnectService } = await import("./connected-accounts");
      await disconnectService(db, userId, "google-workspace");
      expect(revokeGoogleToken).toHaveBeenCalledWith("rt-1");
      const left = await db.select().from(connectedAccounts).where(eq(connectedAccounts.userId, userId));
      expect(left).toEqual([]);
    });
  });
});
