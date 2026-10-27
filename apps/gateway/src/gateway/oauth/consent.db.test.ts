/**
 * SCRUM-373: the consent page, through the REAL authorize and consent
 * routers over HTTP, on real Postgres. What is pinned is the security of the
 * approval itself (one code per Approve, nothing on Deny or on any refusal),
 * which is rows and a transaction, so a stub would pass whatever the SQL does.
 */
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { oauthAuthorizationCodes, oauthClients, oauthConsents, oauthPendingConsents, users } from "@datatorag-mcp/db";
import { hashToken } from "@datatorag-mcp/auth";
import { getTestDb, insertTestUser, isDockerAvailable, stopTestDb } from "@/test-utils/db";

vi.mock("../signup", async (orig) => ({
  ...(await orig<typeof import("../signup")>()),
  onNewUser: vi.fn(async () => undefined),
}));

import { createAuthorizeRouter } from "./authorize";
import { createConsentRouter } from "./consent";

const dockerAvailable = isDockerAvailable();
let db: Database;
let server: Server;
let base: string;
const realFetch = globalThis.fetch;
const REDIRECT = "http://127.0.0.1:9999/callback";

let userEmail = "";

describe.skipIf(!dockerAvailable)("consent (real db)", () => {
  beforeAll(async () => {
    db = await getTestDb();
    const app = express();
    app.use(cookieParser());
    app.use("/oauth", express.json(), express.urlencoded({ extended: true }));
    server = createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    if (typeof addr === "string" || addr === null) throw new Error("no port");
    base = `http://127.0.0.1:${addr.port}`;
    app.use(createAuthorizeRouter(db, { googleClientId: "cid", googleClientSecret: "secret", baseUrl: base }));
    app.use(createConsentRouter(db, { baseUrl: base }));
  }, 120_000);

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await stopTestDb();
  });

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.startsWith("https://oauth2.googleapis.com/token")) {
          return new Response(JSON.stringify({ access_token: "at" }), { status: 200 });
        }
        if (u.startsWith("https://www.googleapis.com/oauth2/v2/userinfo")) {
          return new Response(JSON.stringify({ email: userEmail, name: "Test" }), { status: 200 });
        }
        throw new Error(`unexpected fetch in test: ${u}`);
      })
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function setup(clientName: string | null = "Claude") {
    const userId = await insertTestUser(db);
    const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
    userEmail = u.email;
    const clientId = randomUUID();
    await db.insert(oauthClients).values({
      clientId,
      redirectUris: [REDIRECT],
      clientName,
      grantTypes: ["authorization_code"],
      responseTypes: ["code"],
      tokenEndpointAuthMethod: "none",
    });
    return { userId, clientId };
  }

  function callback(clientId: string) {
    const state = Buffer.from(
      JSON.stringify({
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: "challenge",
        code_challenge_method: "S256",
        state: "client-state",
        nonce: "n1",
      })
    ).toString("base64url");
    return realFetch(`${base}/oauth/callback?code=g&state=${state}`, {
      redirect: "manual",
      headers: { cookie: "mcp_oauth_nonce=n1" },
    });
  }

  /** The consent page for a fresh flow: its pending id and its cookie. */
  async function page(clientId: string) {
    const res = await callback(clientId);
    const html = await res.text();
    const pending = /name="pending" value="([^"]+)"/.exec(html)?.[1] ?? "";
    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith("mcp_consent_nonce=")) ?? "";
    const nonce = setCookie.split(";")[0].slice("mcp_consent_nonce=".length);
    return { res, html, pending, nonce, setCookie };
  }

  function answer(
    pending: string,
    decision: "approve" | "deny",
    opts: { nonce?: string; origin?: string | null; site?: string } = {}
  ) {
    const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
    if (opts.nonce !== undefined) headers.cookie = `mcp_consent_nonce=${opts.nonce}`;
    if (opts.origin !== null) headers.origin = opts.origin ?? base;
    if (opts.site) headers["sec-fetch-site"] = opts.site;
    return realFetch(`${base}/oauth/consent`, {
      method: "POST",
      redirect: "manual",
      headers,
      body: new URLSearchParams({ pending, decision }).toString(),
    });
  }

  const codesFor = (userId: string) =>
    db.select({ id: oauthAuthorizationCodes.id }).from(oauthAuthorizationCodes).where(eq(oauthAuthorizationCodes.userId, userId));
  const consentsFor = (userId: string, clientId: string) =>
    db
      .select({ id: oauthConsents.id })
      .from(oauthConsents)
      .where(and(eq(oauthConsents.userId, userId), eq(oauthConsents.clientId, clientId)));

  it("no consent on record: the callback renders the page and issues no code", async () => {
    const { userId, clientId } = await setup();
    const p = await page(clientId);
    expect(p.res.status).toBe(200);
    expect(p.html).toContain("Allow Claude to use DataToRAG?");
    expect(p.html).toContain(userEmail);
    expect(p.html).toContain("<strong>127.0.0.1</strong>");
    expect(p.pending).toMatch(/^[0-9a-f-]{36}$/);
    expect(p.setCookie).toMatch(/HttpOnly/i);
    expect(p.setCookie).toMatch(/Secure/i);
    expect(p.setCookie).toMatch(/Path=\/oauth\/consent/);
    expect(p.setCookie).toMatch(/SameSite=Lax/i);
    expect(await codesFor(userId)).toEqual([]);
  });

  it("a remembered consent: the callback issues the code with no page", async () => {
    const { userId, clientId } = await setup();
    await db.insert(oauthConsents).values({ userId, clientId });
    const res = await callback(clientId);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^http:\/\/127\.0\.0\.1:9999\/callback\?code=.+&state=client-state$/);
    expect(await codesFor(userId)).toHaveLength(1);
  });

  it("Approve issues one code, with state, and records the consent", async () => {
    const { userId, clientId } = await setup();
    const p = await page(clientId);
    const res = await answer(p.pending, "approve", { nonce: p.nonce });
    expect(res.status).toBe(303);
    const to = new URL(res.headers.get("location")!);
    expect(`${to.origin}${to.pathname}`).toBe(REDIRECT);
    expect(to.searchParams.get("code")).toBeTruthy();
    expect(to.searchParams.get("state")).toBe("client-state");
    expect(await codesFor(userId)).toHaveLength(1);
    // SCRUM-443: the code is stored with its hash beside it.
    const [stored] = await db
      .select({ codeHash: oauthAuthorizationCodes.codeHash })
      .from(oauthAuthorizationCodes)
      .where(eq(oauthAuthorizationCodes.userId, userId));
    expect(stored.codeHash).toBe(hashToken(to.searchParams.get("code")!));
    expect(await consentsFor(userId, clientId)).toHaveLength(1);
    // The cookie is cleared by the answer.
    expect(res.headers.getSetCookie().some((c) => /^mcp_consent_nonce=;/.test(c))).toBe(true);
  });

  it("Deny redirects with access_denied and state, and records nothing", async () => {
    const { userId, clientId } = await setup();
    const p = await page(clientId);
    const res = await answer(p.pending, "deny", { nonce: p.nonce });
    expect(res.status).toBe(303);
    const to = new URL(res.headers.get("location")!);
    expect(to.searchParams.get("error")).toBe("access_denied");
    expect(to.searchParams.get("state")).toBe("client-state");
    expect(to.searchParams.get("code")).toBeNull();
    expect(await codesFor(userId)).toEqual([]);
    expect(await consentsFor(userId, clientId)).toEqual([]);
  });

  it("a wrong nonce, and no nonce, issue nothing", async () => {
    const { userId, clientId } = await setup();
    const p = await page(clientId);
    expect((await answer(p.pending, "approve", { nonce: "not-the-nonce" })).status).toBe(400);
    expect((await answer(p.pending, "approve")).status).toBe(400);
    expect(await codesFor(userId)).toEqual([]);
  });

  it("a pending row answered once cannot be answered again", async () => {
    const { userId, clientId } = await setup();
    const p = await page(clientId);
    expect((await answer(p.pending, "approve", { nonce: p.nonce })).status).toBe(303);
    expect((await answer(p.pending, "approve", { nonce: p.nonce })).status).toBe(400);
    expect(await codesFor(userId)).toHaveLength(1);
  });

  it("an expired pending row issues nothing", async () => {
    const { userId, clientId } = await setup();
    const p = await page(clientId);
    await db
      .update(oauthPendingConsents)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(oauthPendingConsents.id, p.pending));
    expect((await answer(p.pending, "approve", { nonce: p.nonce })).status).toBe(400);
    expect(await codesFor(userId)).toEqual([]);
  });

  it("a cross-origin POST, and one with neither Origin nor Sec-Fetch-Site, issue nothing", async () => {
    const { userId, clientId } = await setup();
    const p = await page(clientId);
    expect((await answer(p.pending, "approve", { nonce: p.nonce, origin: "https://evil.example" })).status).toBe(403);
    expect((await answer(p.pending, "approve", { nonce: p.nonce, origin: null })).status).toBe(403);
    expect((await answer(p.pending, "approve", { nonce: p.nonce, origin: null, site: "cross-site" })).status).toBe(403);
    expect(await codesFor(userId)).toEqual([]);
    // The page is still answerable from its own origin, by Sec-Fetch-Site alone.
    expect((await answer(p.pending, "approve", { nonce: p.nonce, origin: null, site: "same-origin" })).status).toBe(303);
  });
});
