/**
 * SCRUM-468: the Brevo connect, through the real router over real HTTP.
 * What must hold: the start asks Brevo for exactly the connector's scopes and
 * binds the round trip with a nonce, and only for a user Brevo is offered to;
 * the callback stores the account with its hour-long expiry and its company
 * as the label; a connect only a link vouches for needs the link user's own,
 * verified email; nothing is stored on a failed exchange or an unknown email.
 */
import { createServer, type Server } from "node:http";
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
vi.mock("./connected-accounts", () => ({
  upsertServiceAccount: (...a: unknown[]) => upsertServiceAccount(...a),
  connectedElsewhere: vi.fn(async () => null),
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
import { CONNECT_ERROR_NOT_CONFIGURED } from "./post-connect-destination";
import { BREVO_ACCOUNT_URL, BREVO_SCOPES, BREVO_TOKEN_URL, BREVO_USERINFO_URL } from "./connectors/brevo/oauth";

const signInEmail = vi.fn();
const dbMock = {
  select: () => ({ from: () => ({ where: () => ({ limit: signInEmail }) }) }),
} as unknown as Database;

let server: Server;
let base: string;
const realFetch = globalThis.fetch;

function router(withCreds: boolean) {
  return createAuthRouter(dbMock, {
    googleClientId: "cid",
    googleClientSecret: "s",
    gwsClientId: "g",
    gwsClientSecret: "s",
    atlassianClientId: "a",
    atlassianClientSecret: "s",
    notionClientId: "n",
    notionClientSecret: "s",
    baseUrl: "http://127.0.0.1",
    ...(withCreds ? { brevoClientId: "brevo-cid", brevoClientSecret: "brevo-secret" } : {}),
  });
}

let useCreds = true;
beforeAll(async () => {
  const withCreds = router(true);
  const without = router(false);
  const app = express();
  app.use(cookieParser());
  app.use((req, res, next) => (useCreds ? withCreds : without)(req, res, next));
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
let userinfo: Record<string, unknown> = { email: "owner@example.com", email_verified: true };
const exchanged: Array<Record<string, string>> = [];

beforeEach(() => {
  vi.clearAllMocks();
  useCreds = true;
  tokenOk = true;
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
      if (u === BREVO_TOKEN_URL) {
        exchanged.push(Object.fromEntries(new URLSearchParams(String(init?.body))));
        return tokenOk
          ? new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600 }), { status: 200 })
          : new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      }
      if (u === BREVO_USERINFO_URL) return new Response(JSON.stringify(userinfo), { status: 200 });
      if (u === BREVO_ACCOUNT_URL) return new Response(JSON.stringify({ companyName: "Acme" }), { status: 200 });
      throw new Error(`unexpected fetch: ${u}`);
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

function request(path: string, cookie = "dtrmcp_session=s") {
  return realFetch(`${base}${path}`, { redirect: "manual", headers: { cookie } });
}

const CALLBACK = "/auth/brevo/connect/callback?code=c&state=n1";

describe("the Brevo connect start", () => {
  it("sends an offered user to Brevo with exactly the connector's scopes and a nonce in state", async () => {
    const res = await request("/auth/brevo/connect");
    const location = new URL(res.headers.get("location")!);
    expect(`${location.origin}${location.pathname}`).toBe("https://oauth.brevo.com/realms/partner/oauth/authorize");
    expect(location.searchParams.get("scope")).toBe(BREVO_SCOPES);
    expect(location.searchParams.get("client_id")).toBe("brevo-cid");
    expect(location.searchParams.get("redirect_uri")).toBe("http://127.0.0.1/auth/brevo/connect/callback");
    const nonce = res.headers.getSetCookie().find((c) => c.startsWith("brevo_connect_nonce="))!.split(";")[0].split("=")[1];
    expect(location.searchParams.get("state")).toBe(nonce);
  });

  it("refuses a user Brevo is not offered to, before any cookie or call", async () => {
    serviceOfferedTo.mockResolvedValue(false);
    const res = await request("/auth/brevo/connect");
    expect(res.headers.get("location")).toContain("service_not_available");
    expect(res.headers.getSetCookie().some((c) => c.startsWith("brevo_connect_nonce="))).toBe(false);
  });

  it("refuses when the app's credentials are not configured, as every connector does", async () => {
    useCreds = false;
    const res = await request("/auth/brevo/connect");
    expect(res.headers.get("location")).toContain(CONNECT_ERROR_NOT_CONFIGURED);
  });
});

describe("the Brevo connect callback", () => {
  it("exchanges the code with the client secret and stores the account, its hour's expiry and its company", async () => {
    const before = Date.now();
    const res = await request(CALLBACK, "dtrmcp_session=s; brevo_connect_nonce=n1");
    expect(res.headers.get("location")).toContain("connected=brevo");
    expect(exchanged[0]).toMatchObject({ grant_type: "authorization_code", client_id: "brevo-cid", client_secret: "brevo-secret", code: "c" });
    const [, userId, provider, email, tokens, scopes, expiresAt, identity] = upsertServiceAccount.mock.calls[0] as unknown[];
    expect([userId, provider, email, scopes]).toEqual(["user-1", "brevo", "owner@example.com", BREVO_SCOPES]);
    expect(tokens).toEqual({ access_token: "at", refresh_token: "rt" });
    expect((expiresAt as Date).getTime()).toBeGreaterThanOrEqual(before + 3600_000 - 1000);
    expect(identity).toEqual({ label: "Acme" });
  });

  it("with only a link, completes for the link user's own verified email and mints their session", async () => {
    liveWebSessionUserId.mockResolvedValue(null);
    spentConnectLink.mockResolvedValue({ id: "l", userId: "link-user", provider: "brevo", path: "tool_result", clientName: null, expiresAt: new Date() });
    await request(CALLBACK, `brevo_connect_nonce=n1; dtr_connect_link=${"T".repeat(43)}`);
    expect(upsertServiceAccount.mock.calls[0][1]).toBe("link-user");
    expect(createWebSession).toHaveBeenCalledWith(expect.anything(), expect.anything(), "link-user");
  });

  it("with only a link, stores nothing when Brevo says the email is not verified", async () => {
    liveWebSessionUserId.mockResolvedValue(null);
    spentConnectLink.mockResolvedValue({ id: "l", userId: "link-user", provider: "brevo", path: "tool_result", clientName: null, expiresAt: new Date() });
    userinfo = { email: "owner@example.com", email_verified: false };
    const res = await request(CALLBACK, `brevo_connect_nonce=n1; dtr_connect_link=${"T".repeat(43)}`);
    expect(await res.text()).toContain("Sign in to continue");
    expect(upsertServiceAccount).not.toHaveBeenCalled();
    expect(createWebSession).not.toHaveBeenCalled();
  });

  it("with only a link, stores nothing when Brevo makes no verified claim at all", async () => {
    liveWebSessionUserId.mockResolvedValue(null);
    spentConnectLink.mockResolvedValue({ id: "l", userId: "link-user", provider: "brevo", path: "tool_result", clientName: null, expiresAt: new Date() });
    userinfo = { email: "owner@example.com" };
    const res = await request(CALLBACK, `brevo_connect_nonce=n1; dtr_connect_link=${"T".repeat(43)}`);
    expect(await res.text()).toContain("Sign in to continue");
    expect(upsertServiceAccount).not.toHaveBeenCalled();
    expect(createWebSession).not.toHaveBeenCalled();
  });

  it("refuses at the callback a user Brevo is no longer offered to", async () => {
    serviceOfferedTo.mockResolvedValue(false);
    const res = await request(CALLBACK, "dtrmcp_session=s; brevo_connect_nonce=n1");
    expect(res.headers.get("location")).toContain("service_not_available");
    expect(upsertServiceAccount).not.toHaveBeenCalled();
  });

  it("stores nothing on a refused exchange, a missing email or a mismatched state", async () => {
    tokenOk = false;
    expect((await request(CALLBACK, "dtrmcp_session=s; brevo_connect_nonce=n1")).headers.get("location")).toContain("token_exchange_failed");
    tokenOk = true;
    userinfo = {};
    expect((await request(CALLBACK, "dtrmcp_session=s; brevo_connect_nonce=n1")).headers.get("location")).toContain("could_not_resolve_account_email");
    expect((await request(CALLBACK, "dtrmcp_session=s; brevo_connect_nonce=other")).headers.get("location")).toContain("invalid_state");
    expect(upsertServiceAccount).not.toHaveBeenCalled();
  });
});
