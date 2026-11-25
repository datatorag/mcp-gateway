/**
 * The apps a user approved: the listing the Connections page reads, and the
 * one helper that ends a user's grant to one client. Both are rows and one
 * transaction, across three tables scoped by (user, client), so they run on
 * real Postgres: a stub would pass whatever the SQL does.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { oauthAccessTokens, oauthAuthorizationCodes, oauthClients, oauthConsents, oauthRefreshTokens } from "@datatorag-mcp/db";
import { hashToken } from "@datatorag-mcp/auth";
import { getTestDb, insertTestUser, isDockerAvailable, stopTestDb } from "@/test-utils/db";
import { liveWebSessionUserId, WEB_SESSION_CLIENT_ID } from "@/lib/web-session";
import { WEB_OAUTH_CLIENT_ID } from "@/mastra/mcp/client";
import { resolveBearer } from "../bearer-auth";
import { createUploadLink, inspectUploadLink, resetDownloadLinks } from "../file-download";
import { registerSessionCloser } from "../mcp-session";
import { hasConsent } from "./consent";
import { endGrantForClient, InternalClientError, INTERNAL_CLIENT_IDS } from "./grants";
import { listApprovedApps } from "./approved-apps";
import { createTokenRouter } from "./token";

vi.mock("../../lib/posthog-server", () => ({ getPosthog: () => null }));

const HOUR = 3_600_000;

describe.skipIf(!isDockerAvailable())("approved apps (real db)", () => {
  let db: Database;
  const closer = vi.fn(async (_userId: string) => 2);

  let server: Server;
  let base: string;

  beforeAll(async () => {
    db = await getTestDb();
    // The real token endpoint, for the code exchange.
    const app = express();
    app.use("/oauth", express.json(), express.urlencoded({ extended: true }));
    app.use(createTokenRouter(db));
    server = createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    if (typeof addr === "string" || addr === null) throw new Error("no port");
    base = `http://127.0.0.1:${addr.port}`;
  }, 120_000);

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    registerSessionCloser(null);
    await stopTestDb();
  });

  beforeEach(() => {
    closer.mockClear();
    registerSessionCloser(closer);
    resetDownloadLinks();
  });

  /** An open upload link of the user's: the kind of link a grant's end drops. */
  function openLink(userId: string): string {
    const result = createUploadLink({ userId, args: {}, baseUrl: "https://example.test" });
    const token = /\/files\/u\/([\w-]+\.[\w-]+)/.exec(JSON.stringify(result))?.[1];
    if (!token) throw new Error("no link in the tool's answer");
    expect(inspectUploadLink(token).kind).toBe("live");
    return token;
  }

  async function client(name: string | null = "Claude", redirectUris = ["https://claude.ai/api/mcp/auth_callback"]) {
    const clientId = randomUUID();
    await db.insert(oauthClients).values({
      clientId,
      clientName: name,
      redirectUris,
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
    });
    return clientId;
  }

  /** One sign-in's tokens: an access token and a refresh token in a new family. */
  async function grant(
    userId: string,
    clientId: string,
    opts: { createdAt?: Date; expiresAt?: Date; revoked?: boolean } = {}
  ) {
    const access = randomBytes(16).toString("base64url");
    const refresh = randomBytes(16).toString("base64url");
    const createdAt = opts.createdAt ?? new Date();
    const expiresAt = opts.expiresAt ?? new Date(Date.now() + HOUR);
    const revokedAt = opts.revoked ? new Date() : null;
    await db.insert(oauthAccessTokens).values({
      token: access,
      tokenHash: hashToken(access),
      clientId,
      userId,
      expiresAt,
      revokedAt,
      createdAt,
    });
    await db.insert(oauthRefreshTokens).values({
      tokenHash: hashToken(refresh),
      clientId,
      userId,
      expiresAt,
      revokedAt,
      familyId: randomUUID(),
      createdAt,
    });
    return { access, refresh };
  }

  const REDIRECT = "http://127.0.0.1:9999/callback";

  /** An authorization code as `issueAuthorizationCode` writes one, with the
   * verifier its exchange needs. */
  async function issueCode(userId: string, clientId: string, opts: { expiresAt?: Date } = {}) {
    const code = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    await db.insert(oauthAuthorizationCodes).values({
      code,
      codeHash: hashToken(code),
      clientId,
      userId,
      redirectUri: REDIRECT,
      codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
      codeChallengeMethod: "S256",
      expiresAt: opts.expiresAt ?? new Date(Date.now() + 10 * 60_000),
    });
    return { code, verifier, clientId };
  }

  /** The real exchange at POST /oauth/token. */
  async function exchange(issued: { code: string; verifier: string; clientId: string }) {
    const res = await fetch(`${base}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: issued.code,
        redirect_uri: REDIRECT,
        client_id: issued.clientId,
        code_verifier: issued.verifier,
      }),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  async function approve(userId: string, clientId: string, createdAt = new Date()) {
    await db.insert(oauthConsents).values({ userId, clientId, createdAt });
  }

  async function webSession(userId: string): Promise<string> {
    const token = randomBytes(16).toString("base64url");
    await db.insert(oauthAccessTokens).values({
      token,
      tokenHash: hashToken(token),
      clientId: WEB_SESSION_CLIENT_ID,
      userId,
      expiresAt: new Date(Date.now() + HOUR),
    });
    return token;
  }

  async function liveRows(userId: string, clientId: string) {
    const access = await db
      .select({ revokedAt: oauthAccessTokens.revokedAt })
      .from(oauthAccessTokens)
      .where(and(eq(oauthAccessTokens.userId, userId), eq(oauthAccessTokens.clientId, clientId)));
    const refresh = await db
      .select({ revokedAt: oauthRefreshTokens.revokedAt })
      .from(oauthRefreshTokens)
      .where(and(eq(oauthRefreshTokens.userId, userId), eq(oauthRefreshTokens.clientId, clientId)));
    return {
      access: access.filter((r) => r.revokedAt === null).length,
      refresh: refresh.filter((r) => r.revokedAt === null).length,
    };
  }

  describe("endGrantForClient", () => {
    it("revokes every family and every access token for that user and client, and deletes the approval", async () => {
      const userId = await insertTestUser(db);
      const clientId = await client();
      await approve(userId, clientId);
      // Two sign-ins: two refresh families, two access tokens.
      const first = await grant(userId, clientId);
      const second = await grant(userId, clientId);
      expect(await liveRows(userId, clientId)).toEqual({ access: 2, refresh: 2 });

      const result = await endGrantForClient(db, userId, clientId);

      expect(result).toEqual({
        removed: true,
        refreshTokensRevoked: 2,
        accessTokensRevoked: 2,
        codesInvalidated: 0,
        approvalRemoved: true,
        sessionsClosed: 2,
      });
      expect(await liveRows(userId, clientId)).toEqual({ access: 0, refresh: 0 });
      // The bearer the app holds is refused on its next request.
      for (const t of [first.access, second.access]) {
        expect((await resolveBearer(db, t)).ok).toBe(false);
      }
    });

    it("after Remove hasConsent is false, so the next sign-in shows the approval page", async () => {
      const userId = await insertTestUser(db);
      const clientId = await client();
      await approve(userId, clientId);
      await grant(userId, clientId);
      expect(await hasConsent(db, userId, clientId)).toBe(true);

      await endGrantForClient(db, userId, clientId);

      expect(await hasConsent(db, userId, clientId)).toBe(false);
    });

    it("leaves another client of the same user, the same client for another user, and the dashboard session untouched", async () => {
      const userId = await insertTestUser(db);
      const otherUser = await insertTestUser(db);
      const clientId = await client();
      const otherClient = await client("Cursor", ["http://127.0.0.1:7777/callback"]);
      await approve(userId, clientId);
      await approve(userId, otherClient);
      await approve(otherUser, clientId);
      await grant(userId, clientId);
      const mine = await grant(userId, otherClient);
      const theirs = await grant(otherUser, clientId);
      const session = await webSession(userId);

      await endGrantForClient(db, userId, clientId);

      expect(await liveRows(userId, otherClient)).toEqual({ access: 1, refresh: 1 });
      expect(await liveRows(otherUser, clientId)).toEqual({ access: 1, refresh: 1 });
      expect(await hasConsent(db, userId, otherClient)).toBe(true);
      expect(await hasConsent(db, otherUser, clientId)).toBe(true);
      expect((await resolveBearer(db, mine.access)).ok).toBe(true);
      expect((await resolveBearer(db, theirs.access)).ok).toBe(true);
      expect(await liveWebSessionUserId(db, session)).toBe(userId);
      // Only the acting user's sessions are closed.
      expect(closer.mock.calls).toEqual([[userId]]);
    });

    it("refuses the internal client ids by an explicit list, and touches nothing", async () => {
      // The dashboard's session tokens and the dashboard Agent's calls are
      // both stored under this one id.
      expect([...INTERNAL_CLIENT_IDS]).toEqual(["web"]);
      expect(INTERNAL_CLIENT_IDS.has(WEB_SESSION_CLIENT_ID)).toBe(true);
      expect(INTERNAL_CLIENT_IDS.has(WEB_OAUTH_CLIENT_ID)).toBe(true);

      const userId = await insertTestUser(db);
      const session = await webSession(userId);

      for (const id of INTERNAL_CLIENT_IDS) {
        await expect(endGrantForClient(db, userId, id)).rejects.toBeInstanceOf(InternalClientError);
      }
      expect(await liveWebSessionUserId(db, session)).toBe(userId);
      expect(closer).not.toHaveBeenCalled();
    });

    it("drops the user's download and upload links after the commit", async () => {
      const userId = await insertTestUser(db);
      const otherUser = await insertTestUser(db);
      const clientId = await client();
      await grant(userId, clientId);
      const mine = openLink(userId);
      const theirs = openLink(otherUser);

      await endGrantForClient(db, userId, clientId);

      expect(inspectUploadLink(mine).kind).not.toBe("live");
      expect(inspectUploadLink(theirs).kind).toBe("live");
    });

    it("an unknown or already removed client changes nothing, drops nothing, and closes nothing", async () => {
      const userId = await insertTestUser(db);
      const clientId = await client();
      await grant(userId, clientId);
      await endGrantForClient(db, userId, clientId);
      closer.mockClear();
      const link = openLink(userId);

      const again = await endGrantForClient(db, userId, clientId);
      const unknown = await endGrantForClient(db, userId, randomUUID());

      for (const r of [again, unknown]) {
        expect(r).toEqual({
          removed: false,
          refreshTokensRevoked: 0,
          accessTokensRevoked: 0,
          codesInvalidated: 0,
          approvalRemoved: false,
          sessionsClosed: 0,
        });
      }
      expect(closer).not.toHaveBeenCalled();
      expect(inspectUploadLink(link).kind).toBe("live");
    });

    it("a code issued just before Remove cannot be exchanged afterwards", async () => {
      const userId = await insertTestUser(db);
      const clientId = await client();
      await approve(userId, clientId);
      const pending = await issueCode(userId, clientId);

      const result = await endGrantForClient(db, userId, clientId);

      expect(result.codesInvalidated).toBe(1);
      const refused = await exchange(pending);
      expect(refused.status).toBe(400);
      expect(refused.body.error).toBe("invalid_grant");
      expect(refused.body.access_token).toBeUndefined();
      // Nothing was minted for the removed app.
      expect(await liveRows(userId, clientId)).toEqual({ access: 0, refresh: 0 });
    });

    it("a pending code alone is something to remove, and it closes the user's sessions", async () => {
      const userId = await insertTestUser(db);
      const clientId = await client();
      const pending = await issueCode(userId, clientId);

      const result = await endGrantForClient(db, userId, clientId);

      expect(result).toEqual({
        removed: true,
        refreshTokensRevoked: 0,
        accessTokensRevoked: 0,
        codesInvalidated: 1,
        approvalRemoved: false,
        sessionsClosed: 2,
      });
      expect((await exchange(pending)).status).toBe(400);
    });

    it("a code for another client of the same user, or the same client for another user, still works", async () => {
      const userId = await insertTestUser(db);
      const otherUser = await insertTestUser(db);
      const clientId = await client();
      const otherClient = await client("Cursor", ["http://127.0.0.1:7777/callback"]);
      await issueCode(userId, clientId);
      const mineElsewhere = await issueCode(userId, otherClient);
      const theirs = await issueCode(otherUser, clientId);

      const result = await endGrantForClient(db, userId, clientId);

      expect(result.codesInvalidated).toBe(1);
      for (const issued of [mineElsewhere, theirs]) {
        const ok = await exchange(issued);
        expect(ok.status).toBe(200);
        expect(typeof ok.body.access_token).toBe("string");
      }
    });

    it("codes already used or already expired are left as they are and not counted", async () => {
      const userId = await insertTestUser(db);
      const clientId = await client();
      const used = await issueCode(userId, clientId);
      expect((await exchange(used)).status).toBe(200);
      await issueCode(userId, clientId, { expiresAt: new Date(Date.now() - 60_000) });

      const result = await endGrantForClient(db, userId, clientId);

      expect(result.codesInvalidated).toBe(0);
      // The exchange above minted one access and one refresh token; both go.
      expect(result).toMatchObject({ removed: true, refreshTokensRevoked: 1, accessTokensRevoked: 1 });
    });

    it("says so when no server is registered to close sessions", async () => {
      registerSessionCloser(null);
      const userId = await insertTestUser(db);
      const clientId = await client();
      await grant(userId, clientId);

      const result = await endGrantForClient(db, userId, clientId);

      expect(result.removed).toBe(true);
      expect(result.sessionsClosed).toBeNull();
    });
  });

  describe("listApprovedApps", () => {
    it("lists an approved client with its name, redirect host, approval date, and newest token date", async () => {
      const userId = await insertTestUser(db);
      const clientId = await client("Claude", ["https://claude.ai/api/mcp/auth_callback"]);
      const approvedAt = new Date("2026-11-03T10:00:00Z");
      await approve(userId, clientId, approvedAt);
      await grant(userId, clientId, { createdAt: new Date("2026-11-03T10:00:05Z") });
      await grant(userId, clientId, { createdAt: new Date("2026-11-20T08:00:00Z") });

      expect(await listApprovedApps(db, userId)).toEqual([
        {
          clientId,
          name: "Claude",
          redirectHosts: ["claude.ai"],
          approvedAt: approvedAt.toISOString(),
          lastTokenAt: "2026-11-20T08:00:00.000Z",
        },
      ]);
    });

    it("includes a client with live tokens and no approval row, with a null approval date", async () => {
      const userId = await insertTestUser(db);
      const clientId = await client("Older app");
      await grant(userId, clientId);

      const apps = await listApprovedApps(db, userId);

      expect(apps).toHaveLength(1);
      expect(apps[0]).toMatchObject({ clientId, name: "Older app", approvedAt: null });
      expect(apps[0].lastTokenAt).not.toBeNull();
    });

    it("includes an approved client whose tokens have all lapsed, and leaves out one with neither", async () => {
      const userId = await insertTestUser(db);
      const approved = await client("Approved");
      const lapsed = await client("Lapsed");
      const revoked = await client("Revoked");
      await approve(userId, approved);
      await grant(userId, approved, { expiresAt: new Date(Date.now() - HOUR) });
      await grant(userId, lapsed, { expiresAt: new Date(Date.now() - HOUR) });
      await grant(userId, revoked, { revoked: true });

      const apps = await listApprovedApps(db, userId);

      expect(apps.map((a) => a.clientId)).toEqual([approved]);
      // The date is the newest token's, live or not.
      expect(apps[0].lastTokenAt).not.toBeNull();
    });

    it("excludes the internal client and never returns another user's apps", async () => {
      const userId = await insertTestUser(db);
      const otherUser = await insertTestUser(db);
      const theirs = await client("Theirs");
      await approve(otherUser, theirs);
      await grant(otherUser, theirs);
      await webSession(userId);
      // Even an approval row under the internal id is not listed.
      await approve(userId, WEB_SESSION_CLIENT_ID);

      expect(await listApprovedApps(db, userId)).toEqual([]);
      expect((await listApprovedApps(db, otherUser)).map((a) => a.clientId)).toEqual([theirs]);
    });

    it("shows one app that registered twice once per client id, never merged by name", async () => {
      const userId = await insertTestUser(db);
      const real = await client("Claude", ["https://claude.ai/api/mcp/auth_callback"]);
      const lookalike = await client("Claude", ["https://claude.example.net/callback"]);
      await approve(userId, real, new Date("2026-11-01T00:00:00Z"));
      await approve(userId, lookalike, new Date("2026-11-10T00:00:00Z"));

      const apps = await listApprovedApps(db, userId);

      expect(apps.map((a) => [a.clientId, a.redirectHosts])).toEqual([
        [lookalike, ["claude.example.net"]],
        [real, ["claude.ai"]],
      ]);
    });

    it("treats the registered name as untrusted text: cleaned, capped, and null when empty", async () => {
      const userId = await insertTestUser(db);
      const long = await client(`${"A".repeat(300)}`);
      const controls = await client("Claude\n‮evil​");
      const unnamed = await client(null);
      const punycode = await client("Idn", ["https://xn--clude-0qa.ai/callback", "https://xn--clude-0qa.ai/other"]);
      for (const id of [long, controls, unnamed, punycode]) await approve(userId, id);

      const byId = new Map((await listApprovedApps(db, userId)).map((a) => [a.clientId, a]));

      expect([...byId.get(long)!.name!].length).toBeLessThanOrEqual(60);
      expect(byId.get(controls)!.name).toBe("Claude evil");
      expect(byId.get(unnamed)!.name).toBeNull();
      // The host in its ASCII form, once.
      expect(byId.get(punycode)!.redirectHosts).toEqual(["xn--clude-0qa.ai"]);
    });

    it("no longer lists an app once it is removed", async () => {
      const userId = await insertTestUser(db);
      const clientId = await client();
      await approve(userId, clientId);
      await grant(userId, clientId);

      await endGrantForClient(db, userId, clientId);

      expect(await listApprovedApps(db, userId)).toEqual([]);
    });
  });
});
