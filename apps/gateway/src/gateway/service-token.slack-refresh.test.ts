/**
 * SCRUM-454: Slack's refresh, with token rotation on.
 *
 * Built against Slack's documented rotation rules: an access token lasts
 * `expires_in` seconds (12 hours), a refresh is `oauth.v2.user.access` with
 * `grant_type=refresh_token`, it returns a NEW pair, and each refresh token
 * works once: presenting it again is `ok: false`, `invalid_refresh_token`.
 * Errors arrive as HTTP 200 with `ok: false`. So two calls refreshing at once
 * with the same refresh token would leave one caller with a refusal and,
 * after two of those, a connection marked dead. The fake models exactly that.
 *
 * Real Postgres, because the lock is the thing under test: a stub cannot
 * block one transaction behind another.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/google-revoke", () => ({
  revokeGoogleToken: vi.fn(async () => true),
}));
// The analytics side of a recorded failure; the row write stays real.
vi.mock("@/lib/posthog-server", () => ({ getPosthog: () => null }));

import { eq } from "drizzle-orm";
import { serviceConnections, type Database } from "@datatorag-mcp/db";
import { getTestDb, stopTestDb, insertTestUser, isDockerAvailable } from "../test-utils/db";
import { upsertServiceAccount } from "./connected-accounts";
import { PLUGIN_SERVICE_MAP, resolveServiceToken, revokeUpstream } from "./service-token";
import { refreshSlackToken } from "./connectors/slack/tokens";
import { sealedColumns } from "./token-crypto";
import { scopeDelta } from "./scope-grant";

const TOKEN_URL = "https://slack.com/api/oauth.v2.user.access";
const REVOKE_URL = "https://slack.com/api/auth.revoke";

/** Slack's token endpoint under rotation. Generation n holds user-token-n
 * and refresh-token-n; generation 1 is what the connect stored. */
class FakeSlack {
  generation = 1;
  calls: Array<Record<string, string>> = [];
  delayMs = 150;
  /** Force an answer instead of the model: an HTTP status, or an ok:false code. */
  forceStatus: number | null = null;
  forceError: string | null = null;

  async handle(init: RequestInit): Promise<Response> {
    const form = Object.fromEntries(new URLSearchParams(String(init.body)));
    this.calls.push(form);
    await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.forceStatus !== null) return new Response("upstream down", { status: this.forceStatus });
    const refuse = (error: string) => new Response(JSON.stringify({ ok: false, error }), { status: 200 });
    if (this.forceError) return refuse(this.forceError);
    if (form.grant_type !== "refresh_token") return refuse("invalid_grant_type");
    // Single use: only the current generation's refresh token works.
    if (form.refresh_token !== `refresh-token-${this.generation}`) return refuse("invalid_refresh_token");
    this.generation += 1;
    return new Response(
      JSON.stringify({
        ok: true,
        access_token: `user-token-${this.generation}`,
        refresh_token: `refresh-token-${this.generation}`,
        expires_in: 43200,
        token_type: "user",
      }),
      { status: 200 }
    );
  }
}

describe("slack is a service-mapped plugin, and its grant reads complete", () => {
  it("routes slack-mcp to the slack connection", () => {
    expect(PLUGIN_SERVICE_MAP["slack-mcp"]).toBe("slack");
  });

  it("answers complete: Slack's consent is all or nothing", () => {
    expect(scopeDelta("slack", "channels:read search:read")).toMatchObject({ missing: [], complete: true });
  });
});

describe("revokeSlackGrant", () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...savedEnv };
  });

  const row = { userId: "user-1", rowId: "row-1" };
  const sealed = sealedColumns("service_connections", row, {
    accessToken: "user-token-1",
    refreshToken: "refresh-token-1",
  });

  it("revoke posts the access token and never throws", async () => {
    const seen: Array<{ url: string; authorization: string | null; method?: string; body: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        seen.push({
          url: String(url),
          authorization: new Headers(init?.headers).get("authorization"),
          method: init?.method,
          body: String(init?.body ?? ""),
        });
        return new Response(JSON.stringify({ ok: true, revoked: true }), { status: 200 });
      })
    );
    expect(await revokeUpstream("slack", sealed, row)).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ url: REVOKE_URL, method: "POST", authorization: "Bearer user-token-1" });
    // The refresh token is never sent.
    expect(JSON.stringify(seen)).not.toContain("refresh-token-1");

    // A throw, a 5xx and an ok:false all come back false, never thrown.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    await expect(revokeUpstream("slack", sealed, row)).resolves.toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })));
    await expect(revokeUpstream("slack", sealed, row)).resolves.toBe(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: false, error: "invalid_auth" }), { status: 200 }))
    );
    await expect(revokeUpstream("slack", sealed, row)).resolves.toBe(false);
  });
});

describe.skipIf(!isDockerAvailable())("SCRUM-454: refreshSlackToken", () => {
  let db: Database;
  let slack: FakeSlack;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    db = await getTestDb();
  }, 120_000);

  afterAll(async () => {
    await stopTestDb();
  });

  beforeEach(() => {
    process.env.SLACK_CONNECTOR_CLIENT_ID = "slack-cid";
    process.env.SLACK_CONNECTOR_CLIENT_SECRET = "slack-secret";
    slack = new FakeSlack();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        if (String(url) === TOKEN_URL) return slack.handle(init ?? {});
        throw new Error(`unexpected fetch in test: ${String(url)}`);
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...savedEnv };
  });

  /** A connected Slack account holding generation 1, its access token
   * already expired unless told otherwise. */
  async function connected(expiresAt = new Date(Date.now() - 60_000)) {
    const userId = await insertTestUser(db);
    await upsertServiceAccount(
      db,
      userId,
      "slack",
      "person@example.test",
      { access_token: "user-token-1", refresh_token: "refresh-token-1", scope: "channels:read" },
      null,
      expiresAt,
      { externalAccountId: "team-1", label: "Example Co" }
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
        lastRefreshError: serviceConnections.lastRefreshError,
        permanentFailures: serviceConnections.refreshPermanentFailures,
      })
      .from(serviceConnections)
      .where(eq(serviceConnections.id, connId));
    return row;
  }

  it("concurrent refreshes take the row lock and refresh once", async () => {
    const { userId, connId } = await connected();
    const [first, second] = await Promise.all([
      resolveServiceToken(db, userId, "slack"),
      resolveServiceToken(db, userId, "slack"),
    ]);
    expect(slack.calls).toHaveLength(1);
    expect(first).toMatchObject({ token: "user-token-2" });
    expect(second).toMatchObject({ token: "user-token-2" });
    expect(await stored(connId)).toMatchObject({
      access: "user-token-2",
      refresh: "refresh-token-2",
      lastRefreshError: null,
      permanentFailures: 0,
    });
  });

  it("refresh persists the new refresh token and token_expires_at from expires_in", async () => {
    const { userId, connId } = await connected();
    const before = Date.now();
    const outcome = await refreshSlackToken(db, { id: connId, userId }, "refresh-token-1");
    expect(outcome).toEqual({ token: "user-token-2" });
    const row = await stored(connId);
    expect(row).toMatchObject({ access: "user-token-2", refresh: "refresh-token-2" });
    expect(row.expires!.getTime()).toBeGreaterThanOrEqual(before + 43200 * 1000 - 1000);
    expect(row.expires!.getTime()).toBeLessThanOrEqual(Date.now() + 43200 * 1000);
    // Form-encoded, client credentials in the body, the presented token once.
    expect(slack.calls).toEqual([
      {
        client_id: "slack-cid",
        client_secret: "slack-secret",
        grant_type: "refresh_token",
        refresh_token: "refresh-token-1",
      },
    ]);
  });

  it("a caller holding a refresh token that was already rotated uses the stored access token and does not refresh again", async () => {
    const { userId, connId } = await connected();
    await refreshSlackToken(db, { id: connId, userId }, "refresh-token-1");
    slack.calls = [];
    expect(await refreshSlackToken(db, { id: connId, userId }, "refresh-token-1")).toEqual({
      token: "user-token-2",
    });
    expect(slack.calls).toHaveLength(0);
  });

  it("invalid_refresh_token is permanent, a 500 is transient", async () => {
    const { userId, connId } = await connected();
    slack.forceError = "invalid_refresh_token";
    expect(await refreshSlackToken(db, { id: connId, userId }, "refresh-token-1")).toEqual({
      failure: { kind: "permanent", reason: "invalid_refresh_token" },
    });
    // The stored pair is left as it was.
    expect(await stored(connId)).toMatchObject({ access: "user-token-1", refresh: "refresh-token-1" });

    for (const code of ["token_revoked", "invalid_grant"]) {
      slack.forceError = code;
      expect(await refreshSlackToken(db, { id: connId, userId }, "refresh-token-1")).toEqual({
        failure: { kind: "permanent", reason: code },
      });
    }

    slack.forceError = null;
    slack.forceStatus = 500;
    expect(await refreshSlackToken(db, { id: connId, userId }, "refresh-token-1")).toEqual({
      failure: { kind: "transient", reason: "http_5xx" },
    });

    // Any other ok:false code is not understood, so it is transient, and its
    // text is never written through.
    slack.forceStatus = null;
    slack.forceError = "some_new_error";
    expect(await refreshSlackToken(db, { id: connId, userId }, "refresh-token-1")).toEqual({
      failure: { kind: "transient", reason: "unexpected" },
    });
  });

  it("a refused refresh reaches the caller as RefreshFailed and is recorded on the row", async () => {
    const { userId, connId } = await connected();
    slack.forceError = "invalid_refresh_token";
    const result = await resolveServiceToken(db, userId, "slack");
    expect(result).toMatchObject({ refreshFailed: true });
    expect(await stored(connId)).toMatchObject({
      lastRefreshError: "invalid_refresh_token",
      permanentFailures: 1,
    });
  });

  it("does nothing without the client id and secret", async () => {
    const { userId, connId } = await connected();
    delete process.env.SLACK_CONNECTOR_CLIENT_SECRET;
    expect(await refreshSlackToken(db, { id: connId, userId }, "refresh-token-1")).toBeNull();
    expect(slack.calls).toHaveLength(0);
  });

  it("an unexpired token is served as stored, never refreshed on read", async () => {
    const { userId } = await connected(new Date(Date.now() + 3_600_000));
    expect(await resolveServiceToken(db, userId, "slack")).toMatchObject({ token: "user-token-1" });
    expect(slack.calls).toHaveLength(0);
  });
});
