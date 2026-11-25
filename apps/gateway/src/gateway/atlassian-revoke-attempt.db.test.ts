/**
 * An Atlassian disconnect sends one revoke request and records only what
 * status came back.
 *
 * Atlassian's OAuth guides document no revoke endpoint; its discovery
 * document advertises one. So this is an attempt whose effect is unknown: the
 * request is sent, its status is logged and put on `account_disconnected`,
 * and the disconnect deletes the rows whatever happened. Nothing recorded may
 * hold the token, the client secret, or anything Atlassian answered with.
 *
 * Real Postgres via testcontainers: "the rows are deleted regardless" and
 * the other-holder skip are statements about rows.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const capture = vi.fn();
vi.mock("../lib/posthog-server", () => ({
  getPosthog: () => ({ capture, identify: vi.fn() }),
  shutdownPosthog: vi.fn(),
}));
const revokeGoogleToken = vi.fn(async (_token: string) => true);
vi.mock("@/lib/google-revoke", () => ({
  revokeGoogleToken: (token: string) => revokeGoogleToken(token),
}));

import { and, eq } from "drizzle-orm";
import { connectedAccounts, serviceConnections, type Database } from "@datatorag-mcp/db";
import { getTestDb, stopTestDb, insertTestUser, isDockerAvailable } from "../test-utils/db";
import { disconnectAccount, disconnectService, upsertServiceAccount } from "./connected-accounts";
import { clearUserIdentityCache } from "./user-email";
import { ATLASSIAN_REVOKE_URL } from "./connectors/atlassian/oauth";
import { ATLASSIAN_REVOKE_TIMEOUT_MS, attemptAtlassianRevoke } from "./connectors/atlassian/tokens";
import { connectorById } from "./connectors/registry";

const ATLASSIAN = "atlassian";
const CLIENT_ID = "atl-client-id";
const CLIENT_SECRET = "atl-client-secret-value";
const ACCESS = "atl-access-token-value";
const REFRESH = "atl-refresh-token-value";
const BODY_MARK = "atlassian-answer-body-mark";
const HEADER_MARK = "atlassian-answer-header-mark";
const inAnHour = () => new Date(Date.now() + 3_600_000);

type Sent = { url: string; init: RequestInit };

describe.skipIf(!isDockerAvailable())("the Atlassian revoke attempt on disconnect", () => {
  let db: Database;
  let sent: Sent[];
  let answer: () => Promise<Response>;
  let logged: string[];

  beforeAll(async () => {
    db = await getTestDb();
  }, 120_000);

  afterAll(async () => {
    await stopTestDb();
  });

  beforeEach(() => {
    capture.mockReset();
    revokeGoogleToken.mockClear();
    clearUserIdentityCache();
    vi.stubEnv("ATLASSIAN_CLIENT_ID", CLIENT_ID);
    vi.stubEnv("ATLASSIAN_CLIENT_SECRET", CLIENT_SECRET);
    sent = [];
    answer = async () => new Response(BODY_MARK, { status: 200, headers: { "x-mark": HEADER_MARK } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        sent.push({ url: String(url), init: init ?? {} });
        return answer();
      })
    );
    logged = [];
    for (const level of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map((a) => (a instanceof Error ? `${a.name} ${a.message} ${a.stack}` : String(a))).join(" "));
      });
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function connect(
    userId: string,
    email: string,
    tokens: { access_token: string; refresh_token?: string } = { access_token: ACCESS, refresh_token: REFRESH },
    service = ATLASSIAN
  ): Promise<string> {
    await upsertServiceAccount(db, userId, service, email, tokens, null, inAnHour());
    const [row] = await db
      .select({ id: connectedAccounts.id })
      .from(connectedAccounts)
      .where(
        and(
          eq(connectedAccounts.userId, userId),
          eq(connectedAccounts.accountEmail, email),
          eq(connectedAccounts.connectorType, service)
        )
      );
    return row.id;
  }

  async function rowsLeft(userId: string): Promise<number> {
    const accounts = await db.select().from(connectedAccounts).where(eq(connectedAccounts.userId, userId));
    const conns = await db.select().from(serviceConnections).where(eq(serviceConnections.userId, userId));
    return accounts.length + conns.length;
  }

  const outcomeLines = () => logged.filter((l) => l.startsWith("[disconnect] atlassian revoke"));
  const event = () => capture.mock.calls.map((c) => c[0]).find((e) => e.event === "account_disconnected");
  const bodyOf = (s: Sent) => new URLSearchParams(String(s.init.body));

  /** Nothing a person can read afterwards holds a secret or the answer. */
  function expectNothingLeaked() {
    const recorded = [...logged, JSON.stringify(capture.mock.calls)].join("\n");
    for (const secret of [ACCESS, REFRESH, CLIENT_SECRET, BODY_MARK, HEADER_MARK]) {
      expect(recorded).not.toContain(secret);
    }
  }

  it("sends exactly one POST to the revoke address, with the refresh token in a form body", async () => {
    const userId = await insertTestUser(db);
    const accountId = await connect(userId, "one@example.com");

    await disconnectAccount(db, userId, accountId, "dashboard_button");

    expect(sent).toHaveLength(1);
    const [request] = sent;
    expect(request.url).toBe("https://auth.atlassian.com/oauth/revoke");
    expect(request.url).toBe(ATLASSIAN_REVOKE_URL);
    expect(request.init.method).toBe("POST");
    expect(new Headers(request.init.headers).get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(request.init.redirect).toBe("manual");
    expect(request.init.signal).toBeInstanceOf(AbortSignal);
    expect(ATLASSIAN_REVOKE_TIMEOUT_MS).toBe(5000);
    // RFC 7009 with client_secret_post, and nothing else.
    expect(Object.fromEntries(bodyOf(request))).toEqual({
      token: REFRESH,
      token_type_hint: "refresh_token",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });
    // The token is in the body, never in the address.
    expect(request.url).not.toContain(REFRESH);

    expect(outcomeLines()).toEqual(["[disconnect] atlassian revoke outcome=200"]);
    expect(event().properties.atlassian_revoke_outcome).toBe("200");
    expect(await rowsLeft(userId)).toBe(0);
    expectNothingLeaked();
  });

  it.each([
    ["200", () => new Response(BODY_MARK, { status: 200 })],
    ["400", () => new Response(JSON.stringify({ error: "invalid_request", error_description: BODY_MARK }), { status: 400 })],
    ["401", () => new Response(BODY_MARK, { status: 401 })],
    ["503", () => new Response(BODY_MARK, { status: 503, headers: { "x-mark": HEADER_MARK } })],
    ["302", () => new Response(null, { status: 302, headers: { location: `https://example.test/${HEADER_MARK}` } })],
  ])("records an HTTP %s as the status alone, and the rows are deleted", async (status, respond) => {
    answer = async () => respond();
    const userId = await insertTestUser(db);
    const accountId = await connect(userId, `status-${status}@example.com`);

    const result = await disconnectAccount(db, userId, accountId, "dashboard_button");

    expect(result).toEqual({});
    expect(sent).toHaveLength(1);
    expect(outcomeLines()).toEqual([`[disconnect] atlassian revoke outcome=${status}`]);
    expect(event().properties.atlassian_revoke_outcome).toBe(status);
    expect(await rowsLeft(userId)).toBe(0);
    expectNothingLeaked();
  });

  it("a thrown network error is recorded as network_error, and the rows are deleted", async () => {
    // An error whose message carries the request, as an exotic failure can.
    answer = async () => {
      throw new TypeError(`fetch failed for token=${REFRESH} secret=${CLIENT_SECRET}`);
    };
    const userId = await insertTestUser(db);
    const accountId = await connect(userId, "network@example.com");

    await disconnectAccount(db, userId, accountId, "dashboard_button");

    expect(outcomeLines()).toEqual(["[disconnect] atlassian revoke outcome=network_error"]);
    expect(event().properties.atlassian_revoke_outcome).toBe("network_error");
    expect(await rowsLeft(userId)).toBe(0);
    expectNothingLeaked();
  });

  it("a timeout is recorded as timeout, and the rows are deleted", async () => {
    // What `AbortSignal.timeout` rejects a fetch with.
    answer = async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    };
    const userId = await insertTestUser(db);
    const accountId = await connect(userId, "timeout@example.com");

    await disconnectAccount(db, userId, accountId, "dashboard_button");

    expect(outcomeLines()).toEqual(["[disconnect] atlassian revoke outcome=timeout"]);
    expect(event().properties.atlassian_revoke_outcome).toBe("timeout");
    expect(await rowsLeft(userId)).toBe(0);
    expectNothingLeaked();
  });

  it("the request is cut by its own deadline: an answer that never comes ends as timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          })
      )
    );
    const started = Date.now();
    const outcome = await attemptAtlassianRevoke({ accessToken: ACCESS, refreshToken: REFRESH }, 50);
    expect(outcome).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("with no refresh token it falls back to the access token, and says which it sent", async () => {
    const userId = await insertTestUser(db);
    const accountId = await connect(userId, "access-only@example.com", { access_token: ACCESS });

    await disconnectAccount(db, userId, accountId, "dashboard_button");

    expect(sent).toHaveLength(1);
    expect(Object.fromEntries(bodyOf(sent[0]))).toEqual({
      token: ACCESS,
      token_type_hint: "access_token",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });
    expect(event().properties.atlassian_revoke_outcome).toBe("200");
    expectNothingLeaked();
  });

  it("a shared account sends nothing and records skipped_shared", async () => {
    const a = await insertTestUser(db);
    const b = await insertTestUser(db);
    await connect(a, "shared@example.com");
    const accountId = await connect(b, "shared@example.com");

    const { note } = await disconnectAccount(db, b, accountId, "dashboard_button");

    expect(sent).toHaveLength(0);
    expect(note).toContain("Another DataToRAG user still holds this account");
    expect(outcomeLines()).toEqual(["[disconnect] atlassian revoke outcome=skipped_shared"]);
    expect(event().properties).toMatchObject({ atlassian_revoke_outcome: "skipped_shared", revoke_skipped_shared: true });
    expect(await rowsLeft(b)).toBe(0);
    expect(await rowsLeft(a)).toBe(2);

    // A is now the last holder: their disconnect sends the request.
    capture.mockReset();
    logged.length = 0;
    await disconnectService(db, a, ATLASSIAN, "service_wide");
    expect(sent).toHaveLength(1);
    expect(outcomeLines()).toEqual(["[disconnect] atlassian revoke outcome=200"]);
  });

  it("with no client credentials nothing is sent, and it is recorded as not_configured", async () => {
    vi.stubEnv("ATLASSIAN_CLIENT_SECRET", "");
    const userId = await insertTestUser(db);
    const accountId = await connect(userId, "unconfigured@example.com");

    await disconnectAccount(db, userId, accountId, "dashboard_button");

    expect(sent).toHaveLength(0);
    expect(outcomeLines()).toEqual(["[disconnect] atlassian revoke outcome=not_configured"]);
    expect(await rowsLeft(userId)).toBe(0);
  });

  it("with no token to send nothing is sent, and it is recorded as no_token", async () => {
    expect(await attemptAtlassianRevoke({ accessToken: null, refreshToken: "" })).toBe("no_token");
    expect(sent).toHaveLength(0);
  });

  it("the whole-service disconnect sends one request per account and records each", async () => {
    const userId = await insertTestUser(db);
    await connect(userId, "first@example.com", { access_token: "access-first", refresh_token: "refresh-first" });
    await connect(userId, "second@example.com", { access_token: "access-second", refresh_token: "refresh-second" });
    answer = async () => new Response(BODY_MARK, { status: 400 });

    const result = await disconnectService(db, userId, ATLASSIAN, "agent_tool");

    expect(result).toEqual({ disconnected: 2 });
    expect(sent.map((s) => bodyOf(s).get("token")).sort()).toEqual(["refresh-first", "refresh-second"]);
    expect(outcomeLines()).toEqual([
      "[disconnect] atlassian revoke outcome=400",
      "[disconnect] atlassian revoke outcome=400",
    ]);
    const events = capture.mock.calls.map((c) => c[0]).filter((e) => e.event === "account_disconnected");
    expect(events.map((e) => e.properties.atlassian_revoke_outcome)).toEqual(["400", "400"]);
    expect(await rowsLeft(userId)).toBe(0);
    const recorded = [...logged, JSON.stringify(capture.mock.calls)].join("\n");
    for (const secret of ["refresh-first", "refresh-second", "access-first", CLIENT_SECRET, BODY_MARK]) {
      expect(recorded).not.toContain(secret);
    }
  });

  it("the registry still does not claim Atlassian can be told to drop a grant", () => {
    // The request is sent; that it ends the grant is not known. The flag is
    // what `RevokingConnectorId` is derived from, and stays false until it is.
    expect(connectorById(ATLASSIAN)?.revokes).toBe(false);
  });

  describe("Google and Notion are unchanged", () => {
    it("a Google disconnect revokes through Google's own call and carries no Atlassian outcome", async () => {
      const userId = await insertTestUser(db);
      const accountId = await connect(
        userId,
        "google@example.com",
        { access_token: "g-access", refresh_token: "g-refresh" },
        "google-workspace"
      );

      await disconnectAccount(db, userId, accountId, "dashboard_button");

      expect(revokeGoogleToken).toHaveBeenCalledTimes(1);
      expect(revokeGoogleToken).toHaveBeenCalledWith("g-refresh");
      expect(sent).toHaveLength(0);
      expect(outcomeLines()).toEqual([]);
      expect(Object.keys(event().properties)).not.toContain("atlassian_revoke_outcome");
      expect(await rowsLeft(userId)).toBe(0);
    });

    it("a Notion disconnect revokes both tokens at Notion and carries no Atlassian outcome", async () => {
      vi.stubEnv("NOTION_OAUTH_CLIENT_ID", "notion-client");
      vi.stubEnv("NOTION_OAUTH_CLIENT_SECRET", "notion-secret");
      const userId = await insertTestUser(db);
      const accountId = await connect(
        userId,
        "notion@example.com",
        { access_token: "n-access", refresh_token: "n-refresh" },
        "notion"
      );

      await disconnectAccount(db, userId, accountId, "dashboard_button");

      expect(sent.map((s) => s.url)).toEqual([
        "https://api.notion.com/v1/oauth/revoke",
        "https://api.notion.com/v1/oauth/revoke",
      ]);
      expect(sent.map((s) => (JSON.parse(String(s.init.body)) as { token: string }).token).sort()).toEqual([
        "n-access",
        "n-refresh",
      ]);
      expect(outcomeLines()).toEqual([]);
      expect(Object.keys(event().properties)).not.toContain("atlassian_revoke_outcome");
      expect(await rowsLeft(userId)).toBe(0);
    });
  });
});
