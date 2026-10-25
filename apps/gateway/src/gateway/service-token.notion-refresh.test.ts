/**
 * SCRUM-366: Notion's refresh rotates BOTH tokens, and the existing refresh
 * path has no lock.
 *
 * What stage 0 observed (2026-10-21): a refresh returns a new pair. The old
 * pair stays valid until the new access token is first used; before that,
 * presenting the old refresh token again succeeds and invalidates the newer,
 * unused pair; after it, the old refresh token gets invalid_grant. So two
 * calls refreshing at once, each holding the same refresh token, both
 * succeed against Notion and leave two callers holding different tokens,
 * one of them already dead. The fake below models exactly those rules.
 *
 * Real Postgres, because the lock is the thing under test: a stub cannot
 * block one transaction behind another.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/google-revoke", () => ({
  revokeGoogleToken: vi.fn(async () => true),
}));

import { eq, sql } from "drizzle-orm";
import { serviceConnections, type Database } from "@datatorag-mcp/db";
import {
  getTestDb,
  stopTestDb,
  insertTestUser,
  isDockerAvailable,
} from "../test-utils/db";
import { upsertServiceAccount } from "./connected-accounts";
import { refreshNotionToken, resolveServiceToken, revokeUpstream } from "./service-token";
import { sealedColumns } from "./token-crypto";

const TOKEN_URL = "https://api.notion.com/v1/oauth/token";
const REVOKE_URL = "https://api.notion.com/v1/oauth/revoke";

/** Notion's token endpoint as stage 0 observed it. Generation n holds
 * access-n and refresh-n; generation 1 is what the connect stored. */
class FakeNotion {
  generation = 1;
  /** Whether the CURRENT generation's access token has been used. */
  currentUsed = false;
  calls: Array<{ refresh_token: string; authorization: string | null }> = [];
  /** Held before answering, so concurrent callers overlap inside the call. */
  delayMs = 150;
  /** Runs before an answer, for tests that need something to happen while
   * the caller holds the row. */
  beforeAnswer: ((presented: string) => Promise<void>) | null = null;
  /** Force an answer, bypassing the model. */
  forceInvalidGrant = false;

  useAccess(token: string) {
    if (token === `access-${this.generation}`) this.currentUsed = true;
  }

  async handle(init: RequestInit): Promise<Response> {
    const body = JSON.parse(String(init.body)) as { grant_type: string; refresh_token: string };
    this.calls.push({
      refresh_token: body.refresh_token,
      authorization: new Headers(init.headers).get("authorization"),
    });
    await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.beforeAnswer) await this.beforeAnswer(body.refresh_token);
    const presented = Number(body.refresh_token.replace("refresh-", ""));
    const latest = presented === this.generation;
    const previousStillGood = presented === this.generation - 1 && !this.currentUsed;
    if (this.forceInvalidGrant || body.grant_type !== "refresh_token" || !(latest || previousStillGood)) {
      return new Response(
        JSON.stringify({ error: "invalid_grant", error_description: "Invalid refresh token" }),
        { status: 400 }
      );
    }
    this.generation += 1;
    this.currentUsed = false;
    return new Response(
      JSON.stringify({
        access_token: `access-${this.generation}`,
        refresh_token: `refresh-${this.generation}`,
        workspace_id: "ws-a",
        token_type: "bearer",
      }),
      { status: 200 }
    );
  }
}

describe.skipIf(!isDockerAvailable())("SCRUM-366: refreshNotionToken", () => {
  let db: Database;
  let notion: FakeNotion;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    db = await getTestDb();
  }, 120_000);

  afterAll(async () => {
    await stopTestDb();
  });

  beforeEach(() => {
    process.env.NOTION_OAUTH_CLIENT_ID = "notion-cid";
    process.env.NOTION_OAUTH_CLIENT_SECRET = "notion-secret";
    notion = new FakeNotion();
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        if (String(url) === TOKEN_URL) return notion.handle(init ?? {});
        return realFetch(url, init);
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...savedEnv };
  });

  /** A connected Notion workspace holding generation 1. */
  async function connected(): Promise<{ userId: string; connId: string }> {
    const userId = await insertTestUser(db);
    await upsertServiceAccount(
      db,
      userId,
      "notion",
      "person@example.com",
      { access_token: "access-1", refresh_token: "refresh-1" },
      null,
      null,
      { externalAccountId: "ws-a", label: "Acme" }
    );
    const [row] = await db
      .select({ id: serviceConnections.id })
      .from(serviceConnections)
      .where(eq(serviceConnections.userId, userId));
    return { userId, connId: row.id };
  }

  async function stored(connId: string) {
    const [row] = await db
      .select({
        access: serviceConnections.accessToken,
        refresh: serviceConnections.refreshToken,
        expires: serviceConnections.tokenExpiresAt,
      })
      .from(serviceConnections)
      .where(eq(serviceConnections.id, connId));
    return row;
  }

  it("rotates and persists the new pair before returning, with Basic auth and no invented expiry", async () => {
    const { connId, userId } = await connected();
    const token = await refreshNotionToken(db, { id: connId, userId }, "refresh-1");
    expect(token).toBe("access-2");
    expect(await stored(connId)).toEqual({ access: "access-2", refresh: "refresh-2", expires: null });
    expect(notion.calls).toEqual([
      {
        refresh_token: "refresh-1",
        authorization: `Basic ${Buffer.from("notion-cid:notion-secret").toString("base64")}`,
      },
    ]);
  });

  it("two refreshes at once present the refresh token ONCE, and both callers get the same new access token", async () => {
    const { connId, userId } = await connected();
    const [first, second] = await Promise.all([
      refreshNotionToken(db, { id: connId, userId }, "refresh-1"),
      refreshNotionToken(db, { id: connId, userId }, "refresh-1"),
    ]);
    expect(notion.calls).toHaveLength(1);
    expect(first).toBe("access-2");
    expect(second).toBe("access-2");
    expect(await stored(connId)).toMatchObject({ access: "access-2", refresh: "refresh-2" });
    // And the token both callers hold is the one Notion still honours.
    notion.useAccess("access-2");
    expect(notion.generation).toBe(2);
  });

  it("a caller holding a refresh token that was already rotated uses the stored access token and does not refresh again", async () => {
    const { connId, userId } = await connected();
    await refreshNotionToken(db, { id: connId, userId }, "refresh-1");
    notion.calls = [];
    const token = await refreshNotionToken(db, { id: connId, userId }, "refresh-1");
    expect(token).toBe("access-2");
    expect(notion.calls).toHaveLength(0);
  });

  it("invalid_grant after a concurrent rotation re-reads the row and does not declare the connection dead", async () => {
    const { connId, userId } = await connected();
    // While the refresh holds the row, another writer (a reconnect, which
    // takes no lock) rotates it. Its UPDATE waits behind the lock; Notion
    // meanwhile refuses the token this caller presented.
    let rotation: Promise<unknown> | null = null;
    const reconnected = { accessToken: "access-reconnected", refreshToken: "refresh-reconnected" };
    notion.forceInvalidGrant = true;
    notion.beforeAnswer = async () => {
      rotation = db
        .update(serviceConnections)
        .set({
          ...reconnected,
          ...sealedColumns("service_connections", { userId, rowId: connId }, reconnected),
        })
        .where(eq(serviceConnections.id, connId))
        .then(() => undefined);
      // Answer only once that UPDATE is genuinely queued on the row lock.
      for (let i = 0; i < 100; i++) {
        const waiting = await db.execute(
          sql`select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query ilike 'update "service_connections"%'`
        );
        if ((waiting as unknown as Array<{ n: number }>)[0]?.n > 0) return;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error("the rotation never queued on the lock");
    };

    const token = await refreshNotionToken(db, { id: connId, userId }, "refresh-1");
    await rotation;
    expect(token).toBe("access-reconnected");
    expect(await stored(connId)).toMatchObject({
      access: "access-reconnected",
      refresh: "refresh-reconnected",
    });
  });

  it("invalid_grant with nothing rotated is a dead grant: null, and the stored row is left as it was", async () => {
    const { connId, userId } = await connected();
    notion.forceInvalidGrant = true;
    const token = await refreshNotionToken(db, { id: connId, userId }, "refresh-1");
    expect(token).toBeNull();
    expect(await stored(connId)).toMatchObject({ access: "access-1", refresh: "refresh-1" });
  });

  it("does nothing without the client id and secret", async () => {
    const { connId, userId } = await connected();
    delete process.env.NOTION_OAUTH_CLIENT_ID;
    expect(await refreshNotionToken(db, { id: connId, userId }, "refresh-1")).toBeNull();
    expect(notion.calls).toHaveLength(0);
  });

  it("a Notion row with no expiry is served as stored, never refreshed on read", async () => {
    const { userId } = await connected();
    expect(await resolveServiceToken(db, userId, "notion")).toMatchObject({ token: "access-1" });
    expect(notion.calls).toHaveLength(0);
  });

  it("disconnect revokes upstream: Basic auth, both tokens", async () => {
    const revokes: Array<{ token: string; authorization: string | null }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        expect(String(url)).toBe(REVOKE_URL);
        revokes.push({
          token: (JSON.parse(String(init?.body)) as { token: string }).token,
          authorization: new Headers(init?.headers).get("authorization"),
        });
        return new Response("{}", { status: 200 });
      })
    );
    const row = { userId: "user-1", rowId: "row-1" };
    const sealed = sealedColumns("service_connections", row, { accessToken: "access-1", refreshToken: "refresh-1" });
    const ok = await revokeUpstream("notion", sealed, row);
    expect(ok).toBe(true);
    expect(revokes.map((r) => r.token).sort()).toEqual(["access-1", "refresh-1"]);
    for (const r of revokes) {
      expect(r.authorization).toBe(`Basic ${Buffer.from("notion-cid:notion-secret").toString("base64")}`);
    }
  });
});
