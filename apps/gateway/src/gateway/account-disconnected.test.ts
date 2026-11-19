/**
 * SCRUM-500: removing a connection sends `account_disconnected`, once per
 * connection, after its rows are gone, from both disconnect paths. A capture
 * that is off or fails never stands between the user and the disconnect.
 *
 * Real Postgres via testcontainers, with the drizzle migrations applied: the
 * event reads the stored grant and `usage_events`, and the ordering claim
 * (rows gone first) is only meaningful against the real tables.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const capture = vi.fn();
let posthogOn = true;
vi.mock("../lib/posthog-server", () => ({
  getPosthog: () => (posthogOn ? { capture, identify: vi.fn() } : null),
  shutdownPosthog: vi.fn(),
}));
const revokeGoogleToken = vi.fn(async (_token: string) => true);
vi.mock("@/lib/google-revoke", () => ({
  revokeGoogleToken: (token: string) => revokeGoogleToken(token),
}));

import { and, eq } from "drizzle-orm";
import { connectedAccounts, serviceConnections, usageEvents, users, type Database } from "@datatorag-mcp/db";
import { getTestDb, stopTestDb, insertTestUser, isDockerAvailable } from "../test-utils/db";
import { disconnectAccount, disconnectService, upsertServiceAccount } from "./connected-accounts";
import { clearUserIdentityCache } from "./user-email";

const GOOGLE = "google-workspace";
const inAnHour = () => new Date(Date.now() + 3_600_000);

describe.skipIf(!isDockerAvailable())("account_disconnected (SCRUM-500)", () => {
  let db: Database;

  beforeAll(async () => {
    db = await getTestDb();
  }, 120_000);

  afterAll(async () => {
    await stopTestDb();
  });

  beforeEach(() => {
    capture.mockReset();
    revokeGoogleToken.mockClear();
    posthogOn = true;
    clearUserIdentityCache();
  });

  async function connect(userId: string, email: string, scope?: string): Promise<string> {
    await upsertServiceAccount(
      db,
      userId,
      GOOGLE,
      email,
      { access_token: `access-${email}`, refresh_token: `refresh-${email}`, ...(scope ? { scope } : {}) },
      null,
      inAnHour()
    );
    const [row] = await db
      .select({ id: connectedAccounts.id })
      .from(connectedAccounts)
      .where(and(eq(connectedAccounts.userId, userId), eq(connectedAccounts.accountEmail, email)));
    return row.id;
  }

  async function loginEmail(userId: string): Promise<string> {
    const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
    return u.email;
  }

  async function rowsLeft(userId: string): Promise<number> {
    const accounts = await db.select().from(connectedAccounts).where(eq(connectedAccounts.userId, userId));
    const conns = await db.select().from(serviceConnections).where(eq(serviceConnections.userId, userId));
    return accounts.length + conns.length;
  }

  it("the dashboard button sends one event with the closed property set", async () => {
    const userId = await insertTestUser(db);
    const accountId = await connect(userId, "one@example.com");

    await disconnectAccount(db, userId, accountId, "dashboard_button");

    expect(capture).toHaveBeenCalledTimes(1);
    const { distinctId, event, properties } = capture.mock.calls[0][0];
    expect(distinctId).toBe(userId);
    expect(event).toBe("account_disconnected");
    const email = await loginEmail(userId);
    expect(properties).toEqual({
      provider: GOOGLE,
      account_email: "one@example.com",
      trigger: "dashboard_button",
      grant_complete: true,
      missing_scopes: [],
      connected_for_seconds: expect.any(Number),
      tool_calls_made: false,
      revoke_skipped_shared: false,
      user_email: email,
      $set: { email },
    });
    expect(properties.connected_for_seconds).toBeGreaterThanOrEqual(0);
    expect(await rowsLeft(userId)).toBe(0);
  });

  it("reports a partial grant the way account_connected does", async () => {
    const userId = await insertTestUser(db);
    const accountId = await connect(userId, "partial@example.com", "openid email https://www.googleapis.com/auth/gmail.modify");

    await disconnectAccount(db, userId, accountId, "dashboard_button");

    const { properties } = capture.mock.calls[0][0];
    expect(properties.grant_complete).toBe(false);
    expect(properties.missing_scopes).toEqual(["Drive", "Calendar", "Docs", "Sheets", "Slides", "Contacts", "Tasks"]);
  });

  it("tool_calls_made is true once a call used this account since it was connected", async () => {
    const userId = await insertTestUser(db);
    const accountId = await connect(userId, "used@example.com");
    await db.insert(usageEvents).values({
      userId,
      toolName: "gws-mcp__gmail_search",
      connector: GOOGLE,
      accountEmail: "used@example.com",
      status: "success",
      latencyMs: 120,
    });

    await disconnectAccount(db, userId, accountId, "dashboard_button");

    expect(capture.mock.calls[0][0].properties.tool_calls_made).toBe(true);
  });

  it("a call on another account of the same user does not count", async () => {
    const userId = await insertTestUser(db);
    const accountId = await connect(userId, "unused@example.com");
    await connect(userId, "other@example.com");
    await db.insert(usageEvents).values({
      userId,
      toolName: "gws-mcp__gmail_search",
      connector: GOOGLE,
      accountEmail: "other@example.com",
      status: "success",
      latencyMs: 120,
    });

    await disconnectAccount(db, userId, accountId, "dashboard_button");

    expect(capture.mock.calls[0][0].properties.tool_calls_made).toBe(false);
  });

  it("the service-wide paths send one event per connection, after the rows are gone", async () => {
    const userId = await insertTestUser(db);
    await connect(userId, "a@example.com");
    await connect(userId, "b@example.com");
    // Read the tables at the moment of each capture: the rows must already be gone.
    const seenAtCapture: Promise<number>[] = [];
    capture.mockImplementation(() => {
      seenAtCapture.push(rowsLeft(userId));
    });

    const { disconnected } = await disconnectService(db, userId, GOOGLE, "agent_tool");

    expect(disconnected).toBe(2);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture.mock.calls.map((c) => c[0].properties.account_email).sort()).toEqual(["a@example.com", "b@example.com"]);
    expect(capture.mock.calls.every((c) => c[0].properties.trigger === "agent_tool")).toBe(true);
    expect(await Promise.all(seenAtCapture)).toEqual([0, 0]);
  });

  it("the dashboard's service-wide disconnect says so", async () => {
    const userId = await insertTestUser(db);
    await connect(userId, "wide@example.com");

    await disconnectService(db, userId, GOOGLE, "service_wide");

    expect(capture.mock.calls[0][0].properties.trigger).toBe("service_wide");
  });

  it("revoke_skipped_shared is true when another user still holds the account", async () => {
    const holder = await insertTestUser(db);
    const leaver = await insertTestUser(db);
    await connect(holder, "shared@example.com");
    const accountId = await connect(leaver, "shared@example.com");

    await disconnectAccount(db, leaver, accountId, "dashboard_button");

    expect(revokeGoogleToken).not.toHaveBeenCalled();
    expect(capture.mock.calls[0][0].properties.revoke_skipped_shared).toBe(true);
  });

  it("with analytics off, nothing is captured and the disconnect completes", async () => {
    posthogOn = false;
    const userId = await insertTestUser(db);
    const accountId = await connect(userId, "off@example.com");

    await disconnectAccount(db, userId, accountId, "dashboard_button");

    expect(capture).not.toHaveBeenCalled();
    expect(await rowsLeft(userId)).toBe(0);
  });

  it("a capture that throws never blocks either path", async () => {
    capture.mockImplementation(() => {
      throw new Error("posthog down");
    });
    const userId = await insertTestUser(db);
    const accountId = await connect(userId, "throw-a@example.com");
    await connect(userId, "throw-b@example.com");

    await expect(disconnectAccount(db, userId, accountId, "dashboard_button")).resolves.toEqual({});
    await expect(disconnectService(db, userId, GOOGLE, "service_wide")).resolves.toEqual({ disconnected: 1 });
    expect(await rowsLeft(userId)).toBe(0);
  });
});
