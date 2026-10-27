/**
 * SCRUM-190 + SCRUM-164 on real Postgres: a refused refresh is recorded on its
 * connection, the count decides when a grant is dead, a reconnect clears it,
 * and session starts land per default account for the shape alert.
 *
 * Real Postgres because the record is an UPDATE ... count + 1 and the alert
 * is a join over four tables: a stub would agree with whatever the SQL does.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const capture = vi.fn();
vi.mock("../lib/posthog-server", () => ({ getPosthog: () => ({ capture }) }));
vi.mock("@/lib/google-revoke", () => ({ revokeGoogleToken: vi.fn(async () => true) }));

import { and, eq } from "drizzle-orm";
import {
  connectedAccounts,
  mcpSessionStarts,
  serviceConnections,
  usageEvents,
  type Database,
} from "@datatorag-mcp/db";
import { getTestDb, stopTestDb, insertTestUser, isDockerAvailable } from "../test-utils/db";
import { upsertServiceAccount } from "./connected-accounts";
import { resolveServiceToken } from "./service-token";
import { loadConnectionsView } from "./connections-view";
import { BUILT_IN_TOOLS } from "./mcp-server";
import { quietConnections, recordSessionStart } from "./session-starts";
import { runDailyRollup } from "./usage/rollup";

const TOKEN_URLS: Record<string, string> = {
  "google-workspace": "https://oauth2.googleapis.com/token",
  atlassian: "https://auth.atlassian.com/oauth/token",
  notion: "https://api.notion.com/v1/oauth/token",
};
const ACCOUNT = "person@example.com";

/** What the provider's token endpoint answers next: a response, or a throw. */
type Answer = { status: number; body: unknown } | "throw";

describe.skipIf(!isDockerAvailable())("SCRUM-190: refresh failures are recorded (real db)", () => {
  let db: Database;
  let answers: Answer[] = [];
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    db = await getTestDb();
  }, 120_000);
  afterAll(async () => {
    await stopTestDb();
  });

  beforeEach(() => {
    capture.mockClear();
    process.env.GOOGLE_GWS_CLIENT_ID = "g-cid";
    process.env.GOOGLE_GWS_CLIENT_SECRET = "g-secret";
    process.env.ATLASSIAN_CLIENT_ID = "a-cid";
    process.env.ATLASSIAN_CLIENT_SECRET = "a-secret";
    process.env.NOTION_OAUTH_CLIENT_ID = "n-cid";
    process.env.NOTION_OAUTH_CLIENT_SECRET = "n-secret";
    answers = [];
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        if (!Object.values(TOKEN_URLS).includes(String(url))) return realFetch(url, init);
        const next = answers.shift();
        if (!next) throw new Error(`unexpected token request to ${String(url)}`);
        if (next === "throw") throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
        return new Response(typeof next.body === "string" ? next.body : JSON.stringify(next.body), {
          status: next.status,
        });
      })
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...savedEnv };
  });

  /** A connected account whose access token has expired, so the next
   * resolve refreshes. */
  async function connected(service: string): Promise<{ userId: string; connId: string }> {
    const userId = await insertTestUser(db);
    await upsertServiceAccount(
      db,
      userId,
      service,
      ACCOUNT,
      { access_token: "access-1", refresh_token: "refresh-1" },
      null,
      new Date(Date.now() - 60_000),
      service === "notion" ? { externalAccountId: "ws-a", label: "Acme" } : {}
    );
    const [row] = await db
      .select({ id: serviceConnections.id })
      .from(serviceConnections)
      .where(eq(serviceConnections.userId, userId));
    // Notion stores no expiry; set one so its refresh runs.
    await db
      .update(serviceConnections)
      .set({ tokenExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(serviceConnections.id, row.id));
    return { userId, connId: row.id };
  }

  async function health(connId: string) {
    const [row] = await db
      .select({
        at: serviceConnections.lastRefreshAt,
        error: serviceConnections.lastRefreshError,
        count: serviceConnections.refreshPermanentFailures,
      })
      .from(serviceConnections)
      .where(eq(serviceConnections.id, connId));
    return row;
  }

  async function expire(connId: string) {
    await db
      .update(serviceConnections)
      .set({ tokenExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(serviceConnections.id, connId));
  }

  const INVALID_GRANT: Answer = { status: 400, body: { error: "invalid_grant", error_description: "revoked" } };
  const ok = (service: string): Answer => ({
    status: 200,
    body: { access_token: `access-new-${service}`, refresh_token: "refresh-2", expires_in: 3600 },
  });

  for (const service of ["google-workspace", "atlassian", "notion"]) {
    describe(service, () => {
      it("a 400 invalid_grant records the reason, counts one, and returns the failure", async () => {
        const { userId, connId } = await connected(service);
        answers = [INVALID_GRANT];
        const r = await resolveServiceToken(db, userId, service);
        expect(r).toMatchObject({ refreshFailed: true, service, accountEmail: ACCOUNT });
        expect(r).not.toHaveProperty("token");
        const h = await health(connId);
        expect(h.error).toBe("invalid_grant");
        expect(h.count).toBe(1);
        expect(h.at).toBeInstanceOf(Date);
      });

      it.each([
        ["a 429", { status: 429, body: {} } as Answer, "http_429"],
        ["a 500", { status: 500, body: "oops" } as Answer, "http_5xx"],
        ["a thrown fetch", "throw" as Answer, "network"],
      ])("%s records its reason and leaves the count alone", async (_name, answer, reason) => {
        const { userId, connId } = await connected(service);
        answers = [INVALID_GRANT, answer];
        await resolveServiceToken(db, userId, service);
        await expire(connId);
        const r = await resolveServiceToken(db, userId, service);
        // One permanent failure then a transient one: dead for no provider.
        expect(r).toMatchObject({ refreshFailed: true, reconnectNeeded: false });
        expect(await health(connId)).toMatchObject({ error: reason, count: 1 });
      });

      it("a success after failures resets all three", async () => {
        const { userId, connId } = await connected(service);
        answers = [INVALID_GRANT, ok(service)];
        await resolveServiceToken(db, userId, service);
        await expire(connId);
        expect(await resolveServiceToken(db, userId, service)).toMatchObject({ token: `access-new-${service}` });
        const h = await health(connId);
        expect(h).toMatchObject({ error: null, count: 0 });
        expect(h.at).toBeInstanceOf(Date);
      });

      it("missing client credentials records nothing", async () => {
        const { userId, connId } = await connected(service);
        const prefix = { "google-workspace": "GOOGLE_GWS", atlassian: "ATLASSIAN", notion: "NOTION_OAUTH" }[service]!;
        delete process.env[`${prefix}_CLIENT_ID`];
        expect(await resolveServiceToken(db, userId, service)).toBeNull();
        expect(await health(connId)).toEqual({ at: null, error: null, count: 0 });
      });
    });
  }

  describe("when a connection is dead", () => {
    it("Google: one invalid_grant is enough", async () => {
      const { userId } = await connected("google-workspace");
      answers = [INVALID_GRANT];
      expect(await resolveServiceToken(db, userId, "google-workspace")).toMatchObject({ reconnectNeeded: true });
    });

    it("Atlassian: false on the first, true on the second consecutive permanent failure", async () => {
      const { userId, connId } = await connected("atlassian");
      answers = [INVALID_GRANT, INVALID_GRANT];
      expect(await resolveServiceToken(db, userId, "atlassian")).toMatchObject({ reconnectNeeded: false });
      await expire(connId);
      expect(await resolveServiceToken(db, userId, "atlassian")).toMatchObject({ reconnectNeeded: true });
    });

    it("a transient failure between two permanent ones does not reset the count", async () => {
      const { userId, connId } = await connected("atlassian");
      answers = [INVALID_GRANT, { status: 503, body: {} }, INVALID_GRANT];
      await resolveServiceToken(db, userId, "atlassian");
      await expire(connId);
      await resolveServiceToken(db, userId, "atlassian");
      await expire(connId);
      expect(await resolveServiceToken(db, userId, "atlassian")).toMatchObject({ reconnectNeeded: true });
      expect(await health(connId)).toMatchObject({ error: "invalid_grant", count: 2 });
    });

    it("a reconnect clears all three", async () => {
      const { userId, connId } = await connected("google-workspace");
      answers = [INVALID_GRANT];
      await resolveServiceToken(db, userId, "google-workspace");
      await upsertServiceAccount(
        db,
        userId,
        "google-workspace",
        ACCOUNT,
        { access_token: "access-9", refresh_token: "refresh-9" },
        null,
        new Date(Date.now() + 3600_000)
      );
      expect(await health(connId)).toEqual({ at: null, error: null, count: 0 });
    });
  });

  it("service_refresh_failed carries the reason and kind, and no account email, token or body", async () => {
    const { userId } = await connected("google-workspace");
    answers = [INVALID_GRANT];
    await resolveServiceToken(db, userId, "google-workspace");
    await vi.waitFor(() => expect(capture).toHaveBeenCalled());
    const [event] = capture.mock.calls[0];
    expect(event).toMatchObject({
      distinctId: userId,
      event: "service_refresh_failed",
      properties: {
        service: "google-workspace",
        reason: "invalid_grant",
        kind: "permanent",
        consecutive_permanent: 1,
        reconnect_needed: true,
      },
    });
    const text = JSON.stringify(event);
    expect(text).not.toContain(ACCOUNT);
    expect(text).not.toContain("refresh-1");
    expect(text).not.toContain("access-1");
    expect(text).not.toContain("revoked");
  });

  it("list_connected_accounts marks needs_reconnect only on a dead connection", async () => {
    const tool = BUILT_IN_TOOLS.find((t) => t.definition.name === "list_connected_accounts")!;
    const { userId } = await connected("google-workspace");
    const list = async () => {
      const res = (await tool.handler({}, { db, userId } as never)) as { content: Array<{ text: string }> };
      return JSON.parse(res.content[0].text)["google-workspace"][0];
    };
    expect(await list()).not.toHaveProperty("needs_reconnect");
    answers = [INVALID_GRANT];
    await resolveServiceToken(db, userId, "google-workspace");
    expect((await list()).needs_reconnect).toBe(true);
  });

  it("loadConnectionsView reports refresh health per row, from the same rule", async () => {
    const { userId } = await connected("atlassian");
    expect((await loadConnectionsView(db, userId)).accounts[0].refresh).toEqual({ needsReconnect: false, lastError: null });
    answers = [INVALID_GRANT];
    await resolveServiceToken(db, userId, "atlassian");
    const view = await loadConnectionsView(db, userId);
    expect(view.accounts[0].refresh).toEqual({ needsReconnect: false, lastError: "invalid_grant" });
    // The raw columns do not ride along beside the finished answer.
    expect(view.accounts[0]).not.toHaveProperty("refreshPermanentFailures");
  });
});

describe.skipIf(!isDockerAvailable())("SCRUM-164: session starts and the shape alert (real db)", () => {
  let db: Database;
  beforeAll(async () => {
    db = await getTestDb();
  }, 120_000);
  afterAll(async () => {
    await stopTestDb();
  });

  async function account(userId: string, service: string, email: string) {
    await upsertServiceAccount(db, userId, service, email, { access_token: "a", refresh_token: "r" }, null, null);
    const [row] = await db
      .select({ id: connectedAccounts.id, isDefault: connectedAccounts.isDefault })
      .from(connectedAccounts)
      .where(and(eq(connectedAccounts.userId, userId), eq(connectedAccounts.accountEmail, email)));
    return row;
  }

  async function startsFor(userId: string) {
    return db
      .select({ accountId: mcpSessionStarts.connectedAccountId, clientName: mcpSessionStarts.clientName })
      .from(mcpSessionStarts)
      .where(eq(mcpSessionStarts.userId, userId));
  }

  it("an initialize writes one row per default account, and none for a non-default one", async () => {
    const userId = await insertTestUser(db);
    const google = await account(userId, "google-workspace", "a@example.com");
    const second = await account(userId, "google-workspace", "b@example.com");
    const atlassian = await account(userId, "atlassian", "a@example.com");
    expect(second.isDefault).toBe(false);
    await recordSessionStart(db, userId, "Claude\nCode‮");
    const rows = await startsFor(userId);
    expect(rows.map((r) => r.accountId).sort()).toEqual([google.id, atlassian.id].sort());
    expect(rows.every((r) => r.clientName === "Claude Code")).toBe(true);
  });

  it("a user with no connection writes no row", async () => {
    const userId = await insertTestUser(db);
    await recordSessionStart(db, userId, "Cursor");
    expect(await startsFor(userId)).toEqual([]);
  });

  it("a failed insert does not throw", async () => {
    const broken = { execute: async () => { throw new Error("db down"); } } as unknown as Database;
    await expect(recordSessionStart(broken, "u", "Claude")).resolves.toBeUndefined();
  });

  async function startedDaysAgo(userId: string, accountId: string, daysAgo: number[]) {
    for (const d of daysAgo) {
      await db.insert(mcpSessionStarts).values({
        userId,
        connectedAccountId: accountId,
        clientName: "Claude",
        startedAt: new Date(Date.now() - d * 24 * 3600_000 - 60_000),
      });
    }
  }

  it("the alert returns a default account with sessions on enough days and no tool call, and not one with a call", async () => {
    const quietUser = await insertTestUser(db);
    const quiet = await account(quietUser, "google-workspace", "quiet@example.com");
    await startedDaysAgo(quietUser, quiet.id, [0, 1, 2]);

    const busyUser = await insertTestUser(db);
    const busy = await account(busyUser, "google-workspace", "busy@example.com");
    await startedDaysAgo(busyUser, busy.id, [0, 1, 2]);
    await db.insert(usageEvents).values({
      userId: busyUser,
      toolName: "gws-mcp__gmail_list",
      connector: "google-workspace",
      accountEmail: "busy@example.com",
      status: "success",
      latencyMs: 10,
    } as never);

    const rows = await quietConnections(db, 3);
    const emails = rows.map((r) => r.accountEmail);
    expect(emails).toContain("quiet@example.com");
    expect(emails).not.toContain("busy@example.com");
    const row = rows.find((r) => r.accountEmail === "quiet@example.com")!;
    expect(row).toMatchObject({ userId: quietUser, connectorType: "google-workspace", sessions: 3, refreshPermanentFailures: 0 });
    // No token column is selected.
    expect(Object.keys(row).some((k) => /token/i.test(k))).toBe(false);
  });

  it("the rollup prunes session starts older than 90 days", async () => {
    const userId = await insertTestUser(db);
    const a = await account(userId, "atlassian", "old@example.com");
    await startedDaysAgo(userId, a.id, [91, 1]);
    await runDailyRollup(db);
    const left = await db
      .select({ at: mcpSessionStarts.startedAt })
      .from(mcpSessionStarts)
      .where(eq(mcpSessionStarts.userId, userId));
    expect(left).toHaveLength(1);
    expect(left[0].at.getTime()).toBeGreaterThan(Date.now() - 2 * 24 * 3600_000);
  });
});
