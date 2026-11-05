/**
 * SCRUM-471: the PostHog connect, through the real router over real HTTP.
 * What must hold: the document PostHog fetches names its own URL; the start
 * asks for exactly the connector's scopes, one project, and a PKCE challenge
 * bound to a cookie, only for a user PostHog is offered to; the callback
 * proves the code with that verifier and no secret, and stores exactly one
 * project as the account; a connect only a link vouches for needs the link
 * user's own verified email; nothing is stored on any refusal.
 */
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@datatorag-mcp/db";

vi.mock("./track", () => ({
  trackConnectLinkEvent: vi.fn(async () => undefined),
  trackLogin: vi.fn(),
  trackOAuthCompleted: vi.fn(async () => undefined),
  trackConnectDuplicate: vi.fn(async () => undefined),
  trackConnectRefused: vi.fn(async () => undefined),
}));
vi.mock("./attribution", () => ({ stashAttribution: vi.fn(), takeAttribution: vi.fn(() => null) }));
const upsertServiceAccount = vi.fn(async (..._a: unknown[]) => undefined);
const connectedElsewhere = vi.fn(async (..._a: unknown[]) => null);
vi.mock("./connected-accounts", () => ({
  upsertServiceAccount: (...a: unknown[]) => upsertServiceAccount(...a),
  connectedElsewhere: (...a: unknown[]) => connectedElsewhere(...a),
}));
const serviceOfferedTo = vi.fn();
vi.mock("./service-launch", () => ({
  isServiceLaunched: vi.fn(async () => true),
  serviceOfferedTo: (...a: unknown[]) => serviceOfferedTo(...a),
}));
const liveWebSessionUserId = vi.fn();
const createWebSession = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("../lib/web-session", () => ({
  liveWebSessionUserId: (...a: unknown[]) => liveWebSessionUserId(...a),
  createWebSession: (...a: unknown[]) => createWebSession(...a),
}));
const spentConnectLink = vi.fn();
vi.mock("./connect-links", async (orig) => ({
  ...(await orig<typeof import("./connect-links")>()),
  spentConnectLink: (...a: unknown[]) => spentConnectLink(...a),
  dropConnectLinksQuietly: vi.fn(async () => undefined),
}));

import { createAuthRouter } from "./auth";
import { POSTHOG_SCOPES } from "./connectors/posthog/oauth";

const HOST = "https://us.posthog.com";
const BASE = "http://127.0.0.1";
const CLIENT_ID = `${BASE}/auth/posthog/client.json`;

const signInEmail = vi.fn();
const dbMock = {
  select: () => ({ from: () => ({ where: () => ({ limit: signInEmail }) }) }),
} as unknown as Database;

let server: Server;
let base: string;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const app = express();
  app.use(cookieParser());
  app.use(
    createAuthRouter(dbMock, {
      googleClientId: "cid",
      googleClientSecret: "s",
      gwsClientId: "g",
      gwsClientSecret: "s",
      atlassianClientId: "a",
      atlassianClientSecret: "s",
      notionClientId: "n",
      notionClientSecret: "s",
      baseUrl: BASE,
    })
  );
  server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (typeof addr === "string" || addr === null) throw new Error("no port");
  base = `http://127.0.0.1:${addr.port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

let tokenOk = true;
let tokenBody: Record<string, unknown> = {};
let userinfo: Record<string, unknown> = {};
const exchanged: Array<Record<string, string>> = [];

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.POSTHOG_CONNECTOR_BASE_URL;
  tokenOk = true;
  tokenBody = { access_token: "pha_at", refresh_token: "phr_rt", expires_in: 604800, scoped_teams: [42], posthog_base_url: HOST };
  userinfo = { email: "owner@example.com", email_verified: true };
  exchanged.length = 0;
  serviceOfferedTo.mockResolvedValue(true);
  liveWebSessionUserId.mockResolvedValue("user-1");
  spentConnectLink.mockResolvedValue(null);
  signInEmail.mockResolvedValue([{ email: "owner@example.com" }]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u === `${HOST}/oauth/token/`) {
        exchanged.push(Object.fromEntries(new URLSearchParams(String(init?.body))));
        return tokenOk
          ? new Response(JSON.stringify(tokenBody), { status: 200 })
          : new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      }
      if (u === `${HOST}/oauth/userinfo/`) return new Response(JSON.stringify(userinfo), { status: 200 });
      if (u === `${HOST}/api/projects/42/`) return new Response(JSON.stringify({ id: 42, name: "Acme web" }), { status: 200 });
      throw new Error(`unexpected fetch: ${u}`);
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

function request(path: string, cookie = "dtrmcp_session=s") {
  return realFetch(`${base}${path}`, { redirect: "manual", headers: { cookie } });
}

const CALLBACK = "/auth/posthog/connect/callback?code=c&state=n1";
const COOKIES = "dtrmcp_session=s; posthog_connect_nonce=n1; posthog_connect_pkce=the-verifier";

function cookieValue(res: Response, name: string): string | undefined {
  return res.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${name}=`))
    ?.split(";")[0]
    .split("=")[1];
}

describe("the client metadata document", () => {
  it("is served without a session, cached for an hour, naming its own URL", async () => {
    const res = await realFetch(`${base}/auth/posthog/client.json`, { redirect: "manual" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    const doc = (await res.json()) as { client_id: string; redirect_uris: string[] };
    expect(doc.client_id).toBe(CLIENT_ID);
    expect(doc.redirect_uris).toEqual([`${BASE}/auth/posthog/connect/callback`]);
  });
});

describe("the PostHog connect start", () => {
  it("sends an offered user to the regional host with the scopes, one project, a nonce and a PKCE challenge", async () => {
    const res = await request("/auth/posthog/connect");
    const location = new URL(res.headers.get("location")!);
    expect(`${location.origin}${location.pathname}`).toBe(`${HOST}/oauth/authorize/`);
    expect(location.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(location.searchParams.get("scope")).toBe(POSTHOG_SCOPES);
    expect(location.searchParams.get("redirect_uri")).toBe(`${BASE}/auth/posthog/connect/callback`);
    expect(location.searchParams.get("required_access_level")).toBe("project");
    expect(location.searchParams.get("state")).toBe(cookieValue(res, "posthog_connect_nonce"));
    const verifier = cookieValue(res, "posthog_connect_pkce")!;
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("code_challenge")).toBe(createHash("sha256").update(verifier).digest("base64url"));
    const pkceCookie = res.headers.getSetCookie().find((c) => c.startsWith("posthog_connect_pkce="))!;
    expect(pkceCookie).toMatch(/HttpOnly/i);
    expect(pkceCookie).toMatch(/Path=\/auth\/posthog\/connect/);
  });

  it("goes to the EU host when configured", async () => {
    process.env.POSTHOG_CONNECTOR_BASE_URL = "https://eu.posthog.com";
    const res = await request("/auth/posthog/connect");
    expect(res.headers.get("location")!.startsWith("https://eu.posthog.com/oauth/authorize/")).toBe(true);
  });

  it("refuses a user PostHog is not offered to, before any cookie", async () => {
    serviceOfferedTo.mockResolvedValue(false);
    const res = await request("/auth/posthog/connect");
    expect(res.headers.get("location")).toContain("service_not_available");
    expect(res.headers.getSetCookie().some((c) => c.startsWith("posthog_connect_"))).toBe(false);
  });
});

describe("the PostHog connect callback", () => {
  it("proves the code with the verifier and no secret, and stores the one project as the account", async () => {
    const before = Date.now();
    const res = await request(CALLBACK, COOKIES);
    expect(res.headers.get("location")).toContain("connected=posthog");
    expect(exchanged[0]).toEqual({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code: "c",
      code_verifier: "the-verifier",
      redirect_uri: `${BASE}/auth/posthog/connect/callback`,
    });
    const [, userId, provider, email, tokens, scopes, expiresAt, identity] = upsertServiceAccount.mock.calls[0] as unknown[];
    expect([userId, provider, email, scopes]).toEqual(["user-1", "posthog", "owner@example.com", POSTHOG_SCOPES]);
    expect(tokens).toEqual({ access_token: "pha_at", refresh_token: "phr_rt" });
    expect((expiresAt as Date).getTime()).toBeGreaterThanOrEqual(before + 604800_000 - 1000);
    expect(identity).toEqual({ externalAccountId: "42", label: "Acme web" });
    // Both one-shot cookies are spent.
    const cleared = res.headers.getSetCookie().filter((c) => /Expires=Thu, 01 Jan 1970/.test(c)).map((c) => c.split("=")[0]);
    expect(cleared).toEqual(expect.arrayContaining(["posthog_connect_nonce", "posthog_connect_pkce"]));
  });

  it.each([[[]], [[42, 43]], [undefined], [["42"]]])("stores nothing when the grant is not exactly one project (%j)", async (teams) => {
    tokenBody = { ...tokenBody, scoped_teams: teams };
    const res = await request(CALLBACK, COOKIES);
    expect(res.headers.get("location")).toContain("choose_one_project");
    expect(upsertServiceAccount).not.toHaveBeenCalled();
  });

  it("stores nothing when the token says it belongs to another region", async () => {
    tokenBody = { ...tokenBody, posthog_base_url: "https://eu.posthog.com" };
    const res = await request(CALLBACK, COOKIES);
    expect(res.headers.get("location")).toContain("region_not_allowed");
    expect(upsertServiceAccount).not.toHaveBeenCalled();
  });

  it("refuses a round trip with no verifier before any exchange", async () => {
    const res = await request(CALLBACK, "dtrmcp_session=s; posthog_connect_nonce=n1");
    expect(res.headers.get("location")).toContain("invalid_state");
    expect(exchanged).toHaveLength(0);
  });

  it("with only a link, completes for the link user's own verified email and mints their session", async () => {
    liveWebSessionUserId.mockResolvedValue(null);
    spentConnectLink.mockResolvedValue({ id: "l", userId: "link-user", provider: "posthog", path: "tool_result", clientName: null, expiresAt: new Date() });
    await request(CALLBACK, `posthog_connect_nonce=n1; posthog_connect_pkce=the-verifier; dtr_connect_link=${"T".repeat(43)}`);
    expect(upsertServiceAccount.mock.calls[0][1]).toBe("link-user");
    expect(createWebSession).toHaveBeenCalledWith(expect.anything(), expect.anything(), "link-user");
  });

  it.each([[{ email: "owner@example.com", email_verified: false }], [{ email: "owner@example.com" }]])(
    "with only a link, stores nothing without a verified claim (%j)",
    async (info) => {
      liveWebSessionUserId.mockResolvedValue(null);
      spentConnectLink.mockResolvedValue({ id: "l", userId: "link-user", provider: "posthog", path: "tool_result", clientName: null, expiresAt: new Date() });
      userinfo = info;
      const res = await request(CALLBACK, `posthog_connect_nonce=n1; posthog_connect_pkce=the-verifier; dtr_connect_link=${"T".repeat(43)}`);
      expect(await res.text()).toContain("Sign in to continue");
      expect(upsertServiceAccount).not.toHaveBeenCalled();
      expect(createWebSession).not.toHaveBeenCalled();
    }
  );

  it("refuses at the callback a user PostHog is no longer offered to", async () => {
    serviceOfferedTo.mockResolvedValue(false);
    const res = await request(CALLBACK, COOKIES);
    expect(res.headers.get("location")).toContain("service_not_available");
    expect(exchanged).toHaveLength(0);
    expect(upsertServiceAccount).not.toHaveBeenCalled();
  });

  it("stores nothing on a refused exchange, a missing email or a mismatched state", async () => {
    tokenOk = false;
    expect((await request(CALLBACK, COOKIES)).headers.get("location")).toContain("token_exchange_failed");
    tokenOk = true;
    userinfo = {};
    expect((await request(CALLBACK, COOKIES)).headers.get("location")).toContain("could_not_resolve_account_email");
    expect(
      (await request(CALLBACK, "dtrmcp_session=s; posthog_connect_nonce=other; posthog_connect_pkce=v")).headers.get("location")
    ).toContain("invalid_state");
    expect(upsertServiceAccount).not.toHaveBeenCalled();
  });
});
