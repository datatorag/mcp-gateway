/**
 * SCRUM-180: one Google account held by two DataToRAG users. Their tokens are
 * one grant at Google, so a revoke by either kills both, and the user who
 * loses access is not the one who acted. A disconnect by user B must leave
 * user A's calls working; the last holder's disconnect revokes as before.
 *
 * Real Postgres via testcontainers, with the drizzle migrations applied: the
 * other-holder check is a query over the account key, and a stub would answer
 * whatever the test told it to.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const revokeGoogleToken = vi.fn(async (_token: string) => true);
vi.mock("@/lib/google-revoke", () => ({
  revokeGoogleToken: (token: string) => revokeGoogleToken(token),
}));

import { and, eq } from "drizzle-orm";
import { connectedAccounts, serviceConnections, type Database } from "@datatorag-mcp/db";
import { getTestDb, stopTestDb, insertTestUser, isDockerAvailable } from "../test-utils/db";
import { disconnectAccount, disconnectService, upsertServiceAccount } from "./connected-accounts";
import { resolveServiceToken } from "./service-token";
import { connectionDead } from "./refresh-failure";

const SHARED = "shared-mailbox@example.com";
const GOOGLE = "google-workspace";
const inAnHour = () => new Date(Date.now() + 3_600_000);

describe.skipIf(!isDockerAvailable())("a Google account two users hold (SCRUM-180)", () => {
  let db: Database;

  beforeAll(async () => {
    db = await getTestDb();
  }, 120_000);

  afterAll(async () => {
    await stopTestDb();
  });

  beforeEach(() => {
    revokeGoogleToken.mockClear();
  });

  async function holder(token: string): Promise<string> {
    const userId = await insertTestUser(db);
    await upsertServiceAccount(
      db,
      userId,
      GOOGLE,
      SHARED,
      { access_token: `access-${token}`, refresh_token: `refresh-${token}` },
      null,
      inAnHour()
    );
    return userId;
  }

  async function accountIdOf(userId: string): Promise<string> {
    const [row] = await db
      .select({ id: connectedAccounts.id })
      .from(connectedAccounts)
      .where(and(eq(connectedAccounts.userId, userId), eq(connectedAccounts.accountEmail, SHARED)));
    return row.id;
  }

  it("B's disconnect leaves A's grant alone, and A's calls still get a token", async () => {
    const a = await holder("a");
    const b = await holder("b");

    const { note } = await disconnectAccount(db, b, await accountIdOf(b));

    expect(revokeGoogleToken).not.toHaveBeenCalled();
    expect(note).toBe(
      "Disconnected here. Another DataToRAG user still holds this account, so its Google Workspace access was not revoked."
    );
    expect(await resolveServiceToken(db, b, GOOGLE, SHARED)).toBeNull();
    expect(await resolveServiceToken(db, a, GOOGLE, SHARED)).toMatchObject({ token: "access-a", accountEmail: SHARED });

    // A is now the last holder: their disconnect revokes, with no note.
    const last = await disconnectAccount(db, a, await accountIdOf(a));
    expect(revokeGoogleToken).toHaveBeenCalledExactlyOnceWith("refresh-a");
    expect(last.note).toBeUndefined();
  });

  it("the whole-service disconnect follows the same rule", async () => {
    const a = await holder("c");
    const b = await holder("d");

    const { disconnected, note } = await disconnectService(db, b, GOOGLE);

    expect(disconnected).toBe(1);
    expect(note).toMatch(/^Disconnected here\. Another DataToRAG user still holds this account/);
    expect(revokeGoogleToken).not.toHaveBeenCalled();
    expect(await resolveServiceToken(db, a, GOOGLE, SHARED)).toMatchObject({ token: "access-c" });

    await disconnectService(db, a, GOOGLE);
    expect(revokeGoogleToken).toHaveBeenCalledExactlyOnceWith("refresh-c");
  });

  describe("a grant revoked at Google, seen by the user who did not act", () => {
    const savedEnv = { ...process.env };
    afterEach(() => {
      vi.unstubAllGlobals();
      process.env = { ...savedEnv };
    });

    it("a forced refresh of an unexpired token asks Google, and a refusal marks the row needs_reconnect", async () => {
      Object.assign(process.env, { GOOGLE_GWS_CLIENT_ID: "gws-cid", GOOGLE_GWS_CLIENT_SECRET: "gws-secret" });
      const fetch = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
      vi.stubGlobal("fetch", fetch);
      const a = await holder("e");

      // Unexpired, so an ordinary resolve asks Google nothing.
      expect(await resolveServiceToken(db, a, GOOGLE, SHARED)).toMatchObject({ token: "access-e" });
      expect(fetch).not.toHaveBeenCalled();

      expect(await resolveServiceToken(db, a, GOOGLE, SHARED, { forceRefresh: true })).toMatchObject({
        refreshFailed: true,
        reconnectNeeded: true,
        accountEmail: SHARED,
      });
      expect(fetch).toHaveBeenCalledOnce();
      const [row] = await db
        .select({
          lastRefreshError: serviceConnections.lastRefreshError,
          refreshPermanentFailures: serviceConnections.refreshPermanentFailures,
        })
        .from(serviceConnections)
        .where(eq(serviceConnections.userId, a));
      expect(connectionDead(GOOGLE, row)).toBe(true);
    });
  });
});
