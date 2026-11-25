/**
 * SCRUM-471: the PostHog connect, through the real router over real HTTP.
 * What must hold: the document PostHog fetches names its own URL; the start
 * asks for exactly the connector's scopes, one project, and a PKCE challenge
 * bound to a cookie, only for a user PostHog is offered to; the callback
 * proves the code with that verifier and no secret, and stores exactly one
 * project as the account; a connect only a link vouches for needs the link
 * user's own verified email; nothing is stored on any refusal.
 *
 * SCRUM-511: the grant is made on PostHog's authorization server, for every
 * scope PostHog's MCP server supports. The token response names the regional
 * host the token belongs to; the project is read there, and a response
 * naming a host that is not PostHog's is refused before the token is sent
 * anywhere.
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
import { POSTHOG_SCOPE_LIST, POSTHOG_SCOPES } from "./connectors/posthog/oauth";

/** Where the grant is made: authorize, token, and userinfo. */
const OAUTH = "https://oauth.posthog.com";
/** The regional hosts a token can belong to. */
const HOST = "https://us.posthog.com";
const EU_HOST = "https://eu.posthog.com";
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
/** Every address the connect fetched, with the bearer it sent there. */
const fetched: Array<{ url: string; bearer: string | null }> = [];
const fetchedUrls = () => fetched.map((f) => f.url);

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.POSTHOG_CONNECTOR_BASE_URL;
  tokenOk = true;
  tokenBody = { access_token: "pha_at", refresh_token: "phr_rt", expires_in: 604800, scoped_teams: [42], posthog_base_url: HOST };
  userinfo = { email: "owner@example.com", email_verified: true };
  exchanged.length = 0;
  fetched.length = 0;
  serviceOfferedTo.mockResolvedValue(true);
  liveWebSessionUserId.mockResolvedValue("user-1");
  spentConnectLink.mockResolvedValue(null);
  signInEmail.mockResolvedValue([{ email: "owner@example.com" }]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      fetched.push({ url: u, bearer: new Headers(init?.headers).get("authorization") });
      if (u === `${OAUTH}/oauth/token/`) {
        exchanged.push(Object.fromEntries(new URLSearchParams(String(init?.body))));
        return tokenOk
          ? new Response(JSON.stringify(tokenBody), { status: 200 })
          : new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      }
      if (u === `${OAUTH}/oauth/userinfo/`) return new Response(JSON.stringify(userinfo), { status: 200 });
      if (u === `${HOST}/api/projects/42/`) return new Response(JSON.stringify({ id: 42, name: "Acme web" }), { status: 200 });
      if (u === `${EU_HOST}/api/projects/42/`) return new Response(JSON.stringify({ id: 42, name: "Acme EU" }), { status: 200 });
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

  it("caps the client at exactly the scopes the start asks for", async () => {
    const doc = (await (await realFetch(`${base}/auth/posthog/client.json`)).json()) as { "com.posthog": { scopes: string[] } };
    const start = await request("/auth/posthog/connect");
    const asked = new URL(start.headers.get("location")!).searchParams.get("scope")!.split(" ");
    expect(doc["com.posthog"].scopes).toEqual(asked);
    expect(doc["com.posthog"].scopes).toEqual([...POSTHOG_SCOPE_LIST]);
  });
});

describe("the PostHog connect start", () => {
  it("sends an offered user to the authorization server with the scopes, one project, a nonce, and a PKCE challenge", async () => {
    const res = await request("/auth/posthog/connect");
    const location = new URL(res.headers.get("location")!);
    expect(`${location.origin}${location.pathname}`).toBe(`${OAUTH}/oauth/authorize/`);
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

  it("asks on oauth.posthog.com for every MCP scope, writes included", async () => {
    const res = await request("/auth/posthog/connect");
    const location = new URL(res.headers.get("location")!);
    expect(location.origin).toBe("https://oauth.posthog.com");
    const asked = location.searchParams.get("scope")!.split(" ");
    expect(asked).toEqual([...POSTHOG_SCOPE_LIST]);
    expect(asked).toHaveLength(159);
    expect(asked).toEqual(expect.arrayContaining(["openid", "email", "project:read", "dashboard:write"]));
    expect(asked.filter((scope) => scope.endsWith(":write")).length).toBeGreaterThan(0);
  });

  it("still goes to the authorization server when the EU host is configured", async () => {
    process.env.POSTHOG_CONNECTOR_BASE_URL = EU_HOST;
    const res = await request("/auth/posthog/connect");
    expect(res.headers.get("location")!.startsWith(`${OAUTH}/oauth/authorize/`)).toBe(true);
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
    // The code and the identity on the authorization server, the project on
    // the host the token response named.
    expect(fetchedUrls().sort()).toEqual([`${HOST}/api/projects/42/`, `${OAUTH}/oauth/token/`, `${OAUTH}/oauth/userinfo/`].sort());
  });

  it("looks up the project on the EU host when the token response names it", async () => {
    tokenBody = { ...tokenBody, posthog_base_url: EU_HOST };
    const res = await request(CALLBACK, COOKIES);
    expect(res.headers.get("location")).toContain("connected=posthog");
    expect(fetchedUrls()).toContain(`${EU_HOST}/api/projects/42/`);
    expect(fetchedUrls()).not.toContain(`${HOST}/api/projects/42/`);
    expect(exchanged).toHaveLength(1);
    expect(fetchedUrls()).toContain(`${OAUTH}/oauth/userinfo/`);
    expect(upsertServiceAccount.mock.calls[0][7]).toEqual({ externalAccountId: "42", label: "Acme EU" });
  });

  it.each([
    [undefined, HOST],
    [EU_HOST, EU_HOST],
  ])("looks up the project on the configured host (%s) when the token response names none", async (configured, expected) => {
    if (configured) process.env.POSTHOG_CONNECTOR_BASE_URL = configured;
    const { posthog_base_url: _named, ...unnamed } = tokenBody;
    tokenBody = unnamed;
    const res = await request(CALLBACK, COOKIES);
    expect(res.headers.get("location")).toContain("connected=posthog");
    expect(fetchedUrls().filter((u) => u.includes("/api/projects/"))).toEqual([`${expected}/api/projects/42/`]);
    expect(upsertServiceAccount).toHaveBeenCalledTimes(1);
  });

  it.each([[[]], [[42, 43]], [undefined], [["42"]]])("stores nothing when the grant is not exactly one project (%j)", async (teams) => {
    tokenBody = { ...tokenBody, scoped_teams: teams };
    const res = await request(CALLBACK, COOKIES);
    expect(res.headers.get("location")).toContain("choose_one_project");
    expect(upsertServiceAccount).not.toHaveBeenCalled();
  });

  it.each([
    ["https://evil.example"],
    ["https://us.posthog.com.evil.example"],
    ["https://us.posthog.com/"],
    ["http://us.posthog.com"],
    ["https://oauth.posthog.com"],
    [""],
    [null],
    [42],
  ])("stores nothing, and sends the token nowhere, when the token response names a host that is not PostHog's (%j)", async (named) => {
    tokenBody = { ...tokenBody, posthog_base_url: named };
    const res = await request(CALLBACK, COOKIES);
    expect(res.headers.get("location")).toContain("region_not_allowed");
    expect(upsertServiceAccount).not.toHaveBeenCalled();
    // Refused before the identity lookup: the exchange is the only fetch, so
    // the new token never left the gateway.
    expect(fetchedUrls()).toEqual([`${OAUTH}/oauth/token/`]);
    expect(fetched.some((f) => f.bearer !== null)).toBe(false);
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
