/**
 * The Google and Atlassian refreshes, pinned as they are (the two providers
 * with no refresh suite of their own): what is sent, and what is stored from
 * the answer. Driven through `resolveServiceToken` on an expired connection,
 * the path every tool call takes. Real Postgres, because what is under test is
 * what reaches the row.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/google-revoke", () => ({ revokeGoogleToken: vi.fn(async () => true) }));

import { eq } from "drizzle-orm";
import { serviceConnections, type Database } from "@datatorag-mcp/db";
import { getTestDb, stopTestDb, insertTestUser, isDockerAvailable } from "../test-utils/db";
import { upsertServiceAccount } from "./connected-accounts";
import { resolveServiceToken } from "./service-token";

type Sent = { url: string; contentType: string | null; body: Record<string, string> };

const PROVIDERS = [
  {
    service: "google-workspace",
    url: "https://oauth2.googleapis.com/token",
    env: { GOOGLE_GWS_CLIENT_ID: "gws-cid", GOOGLE_GWS_CLIENT_SECRET: "gws-secret" },
    contentType: "application/x-www-form-urlencoded",
    body: { client_id: "gws-cid", client_secret: "gws-secret", refresh_token: "refresh-1", grant_type: "refresh_token" },
    /** Google does not rotate: a refresh token in the answer is ignored. */
    rotates: false,
  },
  {
    service: "atlassian",
    url: "https://auth.atlassian.com/oauth/token",
    env: { ATLASSIAN_CLIENT_ID: "atl-cid", ATLASSIAN_CLIENT_SECRET: "atl-secret" },
    contentType: "application/json",
    body: { grant_type: "refresh_token", client_id: "atl-cid", client_secret: "atl-secret", refresh_token: "refresh-1" },
    rotates: true,
  },
] as const;

describe.skipIf(!isDockerAvailable())("the Google and Atlassian refreshes", () => {
  let db: Database;
  const savedEnv = { ...process.env };
  let sent: Sent[];
  let answer: () => Response;

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

  describe.each(PROVIDERS)("$service", (p) => {
    beforeEach(() => {
      Object.assign(process.env, p.env);
      sent = [];
      answer = () => new Response(JSON.stringify({ access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600 }), { status: 200 });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string | URL, init?: RequestInit) => {
          if (String(url) !== p.url) throw new Error(`unexpected fetch: ${String(url)}`);
          const headers = new Headers(init?.headers);
          const raw = String(init?.body);
          const body =
            headers.get("content-type") === "application/json"
              ? (JSON.parse(raw) as Record<string, string>)
              : Object.fromEntries(new URLSearchParams(raw));
          sent.push({ url: String(url), contentType: headers.get("content-type"), body });
          return answer();
        })
      );
    });

    async function expiredConnection() {
      const userId = await insertTestUser(db);
      await upsertServiceAccount(
        db,
        userId,
        p.service,
        "owner@example.com",
        { access_token: "access-1", refresh_token: "refresh-1" },
        null,
        new Date(Date.now() - 1000)
      );
      return userId;
    }

    async function stored(userId: string) {
      const [row] = await db
        .select({ access: serviceConnections.accessToken, refresh: serviceConnections.refreshToken, expires: serviceConnections.tokenExpiresAt })
        .from(serviceConnections)
        .where(eq(serviceConnections.userId, userId));
      return row;
    }

    it("sends the refresh token with the app's credentials, in the provider's own encoding", async () => {
      const userId = await expiredConnection();
      await resolveServiceToken(db, userId, p.service);
      expect(sent).toEqual([{ url: p.url, contentType: p.contentType, body: p.body }]);
    });

    it("hands out and stores the new access token and its expiry, rotating the refresh token only where the provider does", async () => {
      const userId = await expiredConnection();
      const before = Date.now();
      const resolved = await resolveServiceToken(db, userId, p.service);
      expect(resolved).toMatchObject({ token: "access-2", accountEmail: "owner@example.com" });
      const row = await stored(userId);
      expect(row.access).toBe("access-2");
      expect(row.refresh).toBe(p.rotates ? "refresh-2" : "refresh-1");
      expect(row.expires!.getTime()).toBeGreaterThanOrEqual(before + 3600_000 - 1000);
    });

    it("keeps the refresh token it had when a rotating answer carries none", async () => {
      answer = () => new Response(JSON.stringify({ access_token: "access-2", expires_in: 3600 }), { status: 200 });
      const userId = await expiredConnection();
      await resolveServiceToken(db, userId, p.service);
      expect((await stored(userId)).refresh).toBe("refresh-1");
    });

    it("stores no expiry when the answer has none", async () => {
      answer = () => new Response(JSON.stringify({ access_token: "access-2" }), { status: 200 });
      const userId = await expiredConnection();
      await resolveServiceToken(db, userId, p.service);
      expect((await stored(userId)).expires).toBeNull();
    });

    it("reports a refused refresh and leaves the stored tokens alone", async () => {
      answer = () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      const userId = await expiredConnection();
      expect(await resolveServiceToken(db, userId, p.service)).toMatchObject({ refreshFailed: true, service: p.service });
      expect(await stored(userId)).toMatchObject({ access: "access-1", refresh: "refresh-1" });
    });

    it("reports an answer without an access token as a failure, and stores nothing from it", async () => {
      answer = () => new Response(JSON.stringify({ token_type: "bearer" }), { status: 200 });
      const userId = await expiredConnection();
      expect(await resolveServiceToken(db, userId, p.service)).toMatchObject({ refreshFailed: true });
      expect((await stored(userId)).access).toBe("access-1");
    });

    it("asks the provider nothing without the app's credentials", async () => {
      for (const key of Object.keys(p.env)) delete process.env[key];
      const userId = await expiredConnection();
      await resolveServiceToken(db, userId, p.service);
      expect(sent).toEqual([]);
    });
  });
});
