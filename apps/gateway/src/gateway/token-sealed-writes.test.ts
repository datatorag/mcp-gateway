/**
 * SCRUM-442 and SCRUM-505: every write of a provider token writes it sealed,
 * and only sealed: the plain columns stay empty.
 *
 * Real Postgres with the migrations applied, because what is under test is
 * what reaches the row: each sealed value must open, bound to that row's
 * user and id, to exactly the token written, and `storedTokens` refuses a
 * row whose plain columns hold anything.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/google-revoke", () => ({
  revokeGoogleToken: vi.fn(async () => true),
}));

import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { serviceConnections, type Database } from "@datatorag-mcp/db";
import { getTestDb, stopTestDb, insertTestUser, isDockerAvailable } from "../test-utils/db";
import { upsertServiceAccount } from "./connected-accounts";
import { resolveServiceToken } from "./service-token";
import { storedTokens } from "../test-utils/stored-tokens";

describe.skipIf(!isDockerAvailable())("SCRUM-442, SCRUM-505: provider tokens are written sealed, and only sealed", () => {
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

  /** A service_connections row's tokens, each sealed value opened under the
   * row's own binding; it throws if a plain column was written. */
  async function serviceRow(rowId: string) {
    const [row] = await db
      .select({ refreshTokenSealed: serviceConnections.refreshTokenSealed })
      .from(serviceConnections)
      .where(eq(serviceConnections.id, rowId));
    const tokens = await storedTokens(db, { id: rowId });
    return { openedAccess: tokens.access, openedRefresh: tokens.refresh, refreshTokenSealed: row.refreshTokenSealed };
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
    it("a new connection writes both tokens sealed, bound to its own row, and no plain copy", async () => {
      const userId = await insertTestUser(db);
      const rowId = await connect(userId, "google-workspace", { access_token: "at-1", refresh_token: "rt-1" });
      expect(await serviceRow(rowId)).toMatchObject({
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

  describe("migration 0031, which drops the legacy tables", () => {
    // The migrations have already run here, so the two tables are gone. The
    // guard is tried against stand-ins of the same names, then they go too.
    const guard = () =>
      readFileSync(path.resolve(__dirname, "../../../../packages/db/drizzle/0031_many_mongu.sql"), "utf8").split(
        "--> statement-breakpoint"
      )[0];

    it("refuses while any plugin connection or more than one credit balance is left", async () => {
      await db.execute(sql.raw("CREATE TABLE plugin_connections (id int); CREATE TABLE credit_balances (id int)"));
      try {
        await expect(db.execute(sql.raw(guard()))).resolves.toBeDefined();
        await db.execute(sql.raw("INSERT INTO credit_balances VALUES (1)"));
        await expect(db.execute(sql.raw(guard()))).resolves.toBeDefined();
        await db.execute(sql.raw("INSERT INTO credit_balances VALUES (2)"));
        await expect(db.execute(sql.raw(guard()))).rejects.toThrow(/credit_balances has more than one row/);
        await db.execute(sql.raw("DELETE FROM credit_balances; INSERT INTO plugin_connections VALUES (1)"));
        await expect(db.execute(sql.raw(guard()))).rejects.toThrow(/plugin_connections has rows/);
      } finally {
        await db.execute(sql.raw("DROP TABLE IF EXISTS plugin_connections; DROP TABLE IF EXISTS credit_balances"));
      }
    });
  });
});
