/**
 * SCRUM-466: who a link-started connect is for, at the provider callbacks,
 * through the real router over real HTTP.
 *
 * The attack this stops: somebody sends their own connect link to a victim,
 * who opens it in a browser with no session and connects THEIR account,
 * which would then be readable through the sender's DataToRAG account. So
 * with no session the link alone completes a connect only when the provider
 * account is the link user's own sign-in email; otherwise nothing is stored,
 * no session is minted, and the page asks for a sign-in.
 */
import { createServer, type Server } from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@datatorag-mcp/db";

const trackConnectLinkEvent = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("./track", () => ({
  trackConnectLinkEvent: (...a: unknown[]) => trackConnectLinkEvent(...a),
  trackLogin: vi.fn(),
  trackOAuthCompleted: vi.fn(async () => undefined),
  trackConnectDuplicate: vi.fn(async () => undefined),
  trackConnectRefused: vi.fn(async () => undefined),
}));
vi.mock("./attribution", () => ({
  stashAttribution: vi.fn(),
  takeAttribution: vi.fn(() => null),
}));
const upsertServiceAccount = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("./connected-accounts", () => ({
  upsertServiceAccount: (...a: unknown[]) => upsertServiceAccount(...a),
  connectedElsewhere: vi.fn(async () => null),
}));
vi.mock("./service-launch", () => ({ isServiceLaunched: vi.fn(async () => true) }));
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
import { GWS_SCOPE_LIST } from "./scope-grant";

const LINK_ID = "0b6c1f0e-6a1d-4c35-9a77-2f9a7f1f9a10";
const signInEmail = vi.fn();
const dbMock = {
  select: () => ({ from: () => ({ where: () => ({ limit: signInEmail }) }) }),
  update: () => ({ set: () => ({ where: () => Object.assign(Promise.resolve(), { returning: async () => [] }) }) }),
} as unknown as Database;
const onConnected = vi.fn();

let server: Server;
let base: string;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const app = express();
  app.use(cookieParser());
  app.use(
    createAuthRouter(dbMock, {
      googleClientId: "cid",
      googleClientSecret: "secret",
      gwsClientId: "gws-cid",
      gwsClientSecret: "gws-secret",
      atlassianClientId: "atl-cid",
      atlassianClientSecret: "atl-secret",
      notionClientId: "notion-cid",
      notionClientSecret: "notion-secret",
      baseUrl: "http://127.0.0.1",
      onConnected,
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

/** What each provider says the connected account is. */
let providerEmail = "jane@example.com";
const FULL_SCOPE = GWS_SCOPE_LIST.join(" ");
let googleScope = FULL_SCOPE;

function link(provider: string, userId = "link-user") {
  return { id: LINK_ID, userId, provider, path: "tool_result", clientName: "Claude", expiresAt: new Date("2026-10-30T12:00:00Z") };
}

beforeEach(() => {
  vi.clearAllMocks();
  providerEmail = "jane@example.com";
  googleScope = FULL_SCOPE;
  liveWebSessionUserId.mockResolvedValue(null);
  spentConnectLink.mockImplementation(async (_db: unknown, id: unknown) => (id === LINK_ID ? link("google-workspace") : null));
  signInEmail.mockResolvedValue([{ email: "Jane@Example.com" }]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "at", expires_in: 3600, scope: googleScope }), { status: 200 });
      }
      if (u.startsWith("https://www.googleapis.com/oauth2/v2/userinfo")) {
        return new Response(JSON.stringify({ email: providerEmail }), { status: 200 });
      }
      if (u.startsWith("https://auth.atlassian.com/oauth/token")) {
        return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }), { status: 200 });
      }
      if (u.startsWith("https://api.atlassian.com/me")) {
        return new Response(JSON.stringify({ email: providerEmail }), { status: 200 });
      }
      if (u.startsWith("https://api.notion.com/v1/oauth/token")) {
        return new Response(
          JSON.stringify({ access_token: "at", workspace_id: "ws-1", workspace_name: "W", owner: { user: { person: { email: providerEmail } } } }),
          { status: 200 }
        );
      }
      throw new Error(`unexpected fetch in test: ${u}`);
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function request(path: string, cookie: string) {
  return realFetch(`${base}${path}`, { redirect: "manual", headers: { cookie } });
}

const GOOGLE_CB = "/auth/google/connect/callback?code=c&state=n1";
const GOOGLE_LINK = `gws_connect_nonce=n1; dtr_connect_link=${LINK_ID}; dtr_connect_next=%2Fconnect%2Fdone`;

function cleared(res: Response, name: string): boolean {
  return res.headers.getSetCookie().some((c) => c.startsWith(`${name}=;`));
}

describe("a link-started connect with no session", () => {
  it("completes for the link user's own sign-in email, case aside, and mints that user's session", async () => {
    const res = await request(GOOGLE_CB, GOOGLE_LINK);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/connect/done?connected=google-workspace");
    expect(upsertServiceAccount.mock.calls[0][1]).toBe("link-user");
    expect(createWebSession).toHaveBeenCalledWith(expect.anything(), expect.anything(), "link-user");
    expect(onConnected).toHaveBeenCalledWith({ userId: "link-user", provider: "google-workspace", link: link("google-workspace") });
    expect(trackConnectLinkEvent).toHaveBeenCalledWith("link-user", "connect_completed", {
      provider: "google-workspace",
      path: "tool_result",
      clientName: "Claude",
    });
    expect(cleared(res, "dtr_connect_link")).toBe(true);
  });

  it("stores nothing and mints nothing for any other account, and asks for a sign-in", async () => {
    providerEmail = "victim@example.org";
    const res = await request(GOOGLE_CB, GOOGLE_LINK);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Sign in to continue");
    expect(html).toContain("/auth/google?next=%2Fconnect%2Fresume%2Fgoogle-workspace");
    expect(html).not.toContain("victim@example.org");
    expect(upsertServiceAccount).not.toHaveBeenCalled();
    expect(createWebSession).not.toHaveBeenCalled();
    expect(onConnected).not.toHaveBeenCalled();
    expect(trackConnectLinkEvent).not.toHaveBeenCalled();
    expect(cleared(res, "dtr_connect_link")).toBe(true);
  });

  it("holds for Atlassian and Notion the same way", async () => {
    providerEmail = "victim@example.org";
    for (const [provider, path, nonce] of [
      ["atlassian", "/auth/atlassian/connect/callback?code=c&state=n1", "atl_connect_nonce"],
      ["notion", "/auth/notion/connect/callback?code=c&state=n1", "notion_connect_nonce"],
    ]) {
      spentConnectLink.mockResolvedValue(link(provider));
      const res = await request(path, `${nonce}=n1; dtr_connect_link=${LINK_ID}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain(`%2Fconnect%2Fresume%2F${provider}`);
    }
    expect(upsertServiceAccount).not.toHaveBeenCalled();
    expect(createWebSession).not.toHaveBeenCalled();
  });

  it("a link for another provider vouches for nothing", async () => {
    spentConnectLink.mockResolvedValue(link("atlassian"));
    const res = await request(GOOGLE_CB, GOOGLE_LINK);
    expect(res.headers.get("location")).toBe("/auth/login");
    expect(upsertServiceAccount).not.toHaveBeenCalled();
  });

  it("no link and no session is a sign-in, as before", async () => {
    const res = await request(GOOGLE_CB, "gws_connect_nonce=n1");
    expect(res.headers.get("location")).toBe("/auth/login");
  });

  it("a refused Google grant keeps the link for the retry", async () => {
    googleScope = "openid email";
    const res = await request(GOOGLE_CB, GOOGLE_LINK);
    const set = res.headers.getSetCookie().filter((c) => c.startsWith("dtr_connect_link="));
    expect(set.some((c) => c.startsWith(`dtr_connect_link=${LINK_ID}`))).toBe(true);
    expect(upsertServiceAccount).not.toHaveBeenCalled();
  });
});

describe("a link-started connect with a session", () => {
  it("for the link's user: the session decides, nothing is minted, the link is reported", async () => {
    liveWebSessionUserId.mockResolvedValue("link-user");
    providerEmail = "work@example.org";
    const res = await request(GOOGLE_CB, `dtrmcp_session=s; ${GOOGLE_LINK}`);
    expect(res.headers.get("location")).toBe("/connect/done?connected=google-workspace");
    expect(upsertServiceAccount.mock.calls[0][1]).toBe("link-user");
    expect(createWebSession).not.toHaveBeenCalled();
    expect(onConnected.mock.calls[0][0].link).toEqual(link("google-workspace"));
  });

  it("for another user: the connect is the session's and the link is not reported", async () => {
    liveWebSessionUserId.mockResolvedValue("session-user");
    const res = await request(GOOGLE_CB, `dtrmcp_session=s; ${GOOGLE_LINK}`);
    expect(res.status).toBe(302);
    expect(upsertServiceAccount.mock.calls[0][1]).toBe("session-user");
    expect(onConnected.mock.calls[0][0]).toEqual({ userId: "session-user", provider: "google-workspace", link: null });
    // Not from a link: the website baseline.
    expect(trackConnectLinkEvent).toHaveBeenCalledWith("session-user", "connect_completed", {
      provider: "google-workspace",
      path: "website",
      clientName: null,
    });
  });
});

describe("the connect starts", () => {
  it("go on with a spent link and no session", async () => {
    spentConnectLink.mockResolvedValue(link("atlassian"));
    const res = await request("/auth/atlassian/connect", `dtr_connect_link=${LINK_ID}`);
    expect(res.headers.get("location")).toMatch(/^https:\/\/auth\.atlassian\.com\/authorize/);
  });

  it("send everyone else to sign in", async () => {
    spentConnectLink.mockResolvedValue(null);
    const res = await request("/auth/notion/connect", `dtr_connect_link=${LINK_ID}`);
    expect(res.headers.get("location")).toBe("/auth/login");
  });
});
