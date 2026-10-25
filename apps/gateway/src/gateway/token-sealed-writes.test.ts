/**
 * SCRUM-442, release 1: every write of a provider token also writes it
 * sealed, and the legacy plugin table is written sealed only.
 *
 * Real Postgres with the migrations applied, because what is under test is
 * what reaches the row: each sealed value must open, bound to that row's
 * user and id, to exactly the token written beside it.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/google-revoke", () => ({
  revokeGoogleToken: vi.fn(async () => true),
}));

import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import {
  mcpServers,
  pluginConnections,
  serviceConnections,
  type Database,
} from "@datatorag-mcp/db";
import { getTestDb, stopTestDb, insertTestUser, isDockerAvailable } from "../test-utils/db";
import { upsertServiceAccount } from "./connected-accounts";
import { upsertPluginConnection } from "./plugin-connections";
import { resolvePluginConnectionToken, resolveServiceToken } from "./service-token";
import { openToken, type SealContext } from "./token-crypto";

describe.skipIf(!isDockerAvailable())("SCRUM-442: provider tokens are written sealed", () => {
  let db: Database;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    db = await getTestDb();
  }, 120_000);

  afterAll(async () => {
    await stopTestDb();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...savedEnv };
  });

  /** A service_connections row's tokens, with each sealed value opened under
   * the row's own binding. */
  async function serviceRow(rowId: string) {
    const [row] = await db
      .select({
        userId: serviceConnections.userId,
        accessToken: serviceConnections.accessToken,
        refreshToken: serviceConnections.refreshToken,
        accessTokenSealed: serviceConnections.accessTokenSealed,
        refreshTokenSealed: serviceConnections.refreshTokenSealed,
      })
      .from(serviceConnections)
      .where(eq(serviceConnections.id, rowId));
    const at = (column: SealContext["column"]): SealContext => ({
      table: "service_connections",
      column,
      userId: row.userId,
      rowId,
    });
    return {
      ...row,
      openedAccess: row.accessTokenSealed && openToken(row.accessTokenSealed, at("access_token")),
      openedRefresh: row.refreshTokenSealed && openToken(row.refreshTokenSealed, at("refresh_token")),
    };
  }

  async function connect(userId: string, service: string, tokens: { access_token: string; refresh_token?: string }, expiresAt: Date | null = null) {
    await upsertServiceAccount(db, userId, service, `${service}@example.com`, tokens, null, expiresAt);
    const [row] = await db
      .select({ id: serviceConnections.id })
      .from(serviceConnections)
      .where(eq(serviceConnections.userId, userId));
    return row.id;
  }

  describe("upsertServiceAccount", () => {
    it("a new connection writes both tokens plain and sealed, bound to its own row", async () => {
      const userId = await insertTestUser(db);
      const rowId = await connect(userId, "google-workspace", { access_token: "at-1", refresh_token: "rt-1" });
      expect(await serviceRow(rowId)).toMatchObject({
        accessToken: "at-1",
        refreshToken: "rt-1",
        openedAccess: "at-1",
        openedRefresh: "rt-1",
      });
    });

    it("a reconnect re-seals under the existing row's id", async () => {
      const userId = await insertTestUser(db);
      const rowId = await connect(userId, "atlassian", { access_token: "at-1", refresh_token: "rt-1" });
      const again = await connect(userId, "atlassian", { access_token: "at-2", refresh_token: "rt-2" });
      expect(again).toBe(rowId);
      expect(await serviceRow(rowId)).toMatchObject({ openedAccess: "at-2", openedRefresh: "rt-2" });
    });

    it("no refresh token writes a null sealed refresh token", async () => {
      const userId = await insertTestUser(db);
      const rowId = await connect(userId, "notion", { access_token: "at-1" });
      expect(await serviceRow(rowId)).toMatchObject({
        refreshToken: null,
        refreshTokenSealed: null,
        openedAccess: "at-1",
      });
    });
  });

  describe("refresh", () => {
    const expired = () => new Date(Date.now() - 60_000);

    beforeEach(() => {
      process.env.GOOGLE_GWS_CLIENT_ID = "g-cid";
      process.env.GOOGLE_GWS_CLIENT_SECRET = "g-secret";
      process.env.ATLASSIAN_CLIENT_ID = "a-cid";
      process.env.ATLASSIAN_CLIENT_SECRET = "a-secret";
    });

    function provider(body: Record<string, unknown>) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
      );
    }

    it("Google seals the new access token and leaves the refresh column as it was", async () => {
      const userId = await insertTestUser(db);
      const rowId = await connect(userId, "google-workspace", { access_token: "at-1", refresh_token: "rt-1" }, expired());
      provider({ access_token: "at-2", expires_in: 3600 });
      expect(await resolveServiceToken(db, userId, "google-workspace")).toMatchObject({ token: "at-2" });
      expect(await serviceRow(rowId)).toMatchObject({
        accessToken: "at-2",
        openedAccess: "at-2",
        openedRefresh: "rt-1",
      });
    });

    it("Atlassian seals both rotated tokens", async () => {
      const userId = await insertTestUser(db);
      const rowId = await connect(userId, "atlassian", { access_token: "at-1", refresh_token: "rt-1" }, expired());
      provider({ access_token: "at-2", refresh_token: "rt-2", expires_in: 3600 });
      await resolveServiceToken(db, userId, "atlassian");
      expect(await serviceRow(rowId)).toMatchObject({
        refreshToken: "rt-2",
        openedAccess: "at-2",
        openedRefresh: "rt-2",
      });
    });

    it("Notion seals both rotated tokens inside its lock", async () => {
      process.env.NOTION_OAUTH_CLIENT_ID = "n-cid";
      process.env.NOTION_OAUTH_CLIENT_SECRET = "n-secret";
      const userId = await insertTestUser(db);
      const rowId = await connect(userId, "notion", { access_token: "at-1", refresh_token: "rt-1" }, expired());
      provider({ access_token: "at-2", refresh_token: "rt-2" });
      await resolveServiceToken(db, userId, "notion");
      expect(await serviceRow(rowId)).toMatchObject({ openedAccess: "at-2", openedRefresh: "rt-2" });
    });
  });

  describe("the legacy plugin_connections table", () => {
    async function server(): Promise<string> {
      const [row] = await db
        .insert(mcpServers)
        .values({ slug: `legacy-${Math.random().toString(36).slice(2)}`, name: "Legacy" })
        .returning({ id: mcpServers.id });
      return row.id;
    }

    async function pluginRow(userId: string, mcpServerId: string) {
      const [row] = await db
        .select()
        .from(pluginConnections)
        .where(eq(pluginConnections.userId, userId));
      expect(row.mcpServerId).toBe(mcpServerId);
      return row;
    }

    it("is written sealed only, and the token reads back opened", async () => {
      const userId = await insertTestUser(db);
      const mcpServerId = await server();
      const fields = { provider: "legacy", tokenExpiresAt: null, scopes: "s" };
      await upsertPluginConnection(db, userId, mcpServerId, { ...fields, accessToken: "pat-1", refreshToken: "prt-1" });
      const first = await pluginRow(userId, mcpServerId);
      expect(first).toMatchObject({ accessToken: null, refreshToken: null });
      expect(
        openToken(first.accessTokenSealed!, {
          table: "plugin_connections",
          column: "access_token",
          userId,
          rowId: first.id,
        })
      ).toBe("pat-1");
      expect(await resolvePluginConnectionToken(db, userId, mcpServerId)).toBe("pat-1");

      // A reconnect updates the same row, sealed under its id.
      await upsertPluginConnection(db, userId, mcpServerId, { ...fields, accessToken: "pat-2", refreshToken: null });
      const second = await pluginRow(userId, mcpServerId);
      expect(second.id).toBe(first.id);
      expect(second.refreshTokenSealed).toBeNull();
      expect(await resolvePluginConnectionToken(db, userId, mcpServerId)).toBe("pat-2");

      await db.delete(pluginConnections).where(eq(pluginConnections.userId, userId));
    });

    it("resolves nothing for a user with no connection", async () => {
      const userId = await insertTestUser(db);
      expect(await resolvePluginConnectionToken(db, userId, await server())).toBeNull();
    });

    it("migration 1 refuses while the table holds a row", async () => {
      const userId = await insertTestUser(db);
      const mcpServerId = await server();
      await db.insert(pluginConnections).values({ userId, mcpServerId, provider: "legacy" });
      const file = path.resolve(__dirname, "../../../../packages/db/drizzle/0023_provider_tokens_sealed.sql");
      const guard = readFileSync(file, "utf8").split("--> statement-breakpoint")[0];
      await expect(db.execute(sql.raw(guard))).rejects.toThrow(/plugin_connections has rows/);
      await db.delete(pluginConnections).where(eq(pluginConnections.userId, userId));
      await expect(db.execute(sql.raw(guard))).resolves.toBeDefined();
    });
  });
});
