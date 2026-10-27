/**
 * SCRUM-89: a signup gets the same side effects whichever door it came in by.
 * A signup that started in an MCP client (Claude, Claude Code, Cursor) used to
 * get a user row and nothing else: no acquisition record, no signup event, no
 * welcome email, no #leads post. Both callbacks now call one function.
 *
 * Driven through the REAL routers over real HTTP, so what is pinned is the
 * wiring in each callback, not only the shared function.
 */

import { createServer, type Server } from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@datatorag-mcp/db";
import { oauthAccessTokens, oauthAuthorizationCodes, oauthClients, oauthConsents, users } from "@datatorag-mcp/db";
import { hashToken } from "@datatorag-mcp/auth";

vi.mock("./track", () => ({
  trackLogin: vi.fn(),
  trackSignup: vi.fn(),
  trackOAuthCompleted: vi.fn(async () => undefined),
}));
vi.mock("./attribution", () => ({
  stashAttribution: vi.fn(),
  takeAttribution: vi.fn(() => ({ utmSource: "newsletter" })),
  persistAcquisition: vi.fn(async () => undefined),
}));
vi.mock("./lifecycle", () => ({
  sendWelcomeEmail: vi.fn(async () => undefined),
}));
vi.mock("./signup-alert", () => ({
  notifySignup: vi.fn(async () => undefined),
}));

import { createAuthRouter } from "./auth";
import { createAuthorizeRouter } from "./oauth/authorize";
import { findOrCreateGoogleUser, onNewUser } from "./signup";
import { trackLogin, trackSignup } from "./track";
import { persistAcquisition } from "./attribution";
import { sendWelcomeEmail } from "./lifecycle";
import { notifySignup } from "./signup-alert";

const NEW_USER = { id: "user-new", email: "new@example.com", name: "New", plan: "free", createdAt: new Date() };
const OLD_USER = { id: "user-old", email: "new@example.com", name: "Old", plan: "free", createdAt: new Date() };
const REDIRECT = "http://127.0.0.1:9999/callback";

/** What the users lookups answer, in order, and what the claiming insert
 * returns: [] when another sign-in created the row first. */
let userLookups: unknown[][] = [];
let inserted: unknown[] = [];
let clientName: string | null = "Claude";
const insertedRows: Array<{ table: unknown; v: Record<string, unknown> }> = [];

const dbMock = {
  select: () => ({
    from: (table: unknown) => ({
      where: () => ({
        limit: async () =>
          table === oauthClients
            ? [{ redirectUris: [REDIRECT], clientName }]
            : // The client is already approved (SCRUM-373), so the callback
              // issues its code and the signup path is what is under test.
              table === oauthConsents
              ? [{ id: "consent-1" }]
              : (userLookups.shift() ?? []),
      }),
    }),
  }),
  insert: (table: unknown) => ({
    values: (v: Record<string, unknown>) => {
      insertedRows.push({ table, v });
      const done = Promise.resolve([]);
      return {
        onConflictDoNothing: () => ({ returning: async () => (table === users ? inserted : []) }),
        returning: async () => [],
        then: (r: (v: unknown) => void, j?: (e: unknown) => void) => done.then(r, j),
      };
    },
  }),
  update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
} as unknown as Database;

let server: Server;
let base: string;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const app = express();
  app.use(cookieParser());
  const google = { googleClientId: "cid", googleClientSecret: "secret", baseUrl: "http://127.0.0.1" };
  app.use(
    createAuthRouter(dbMock, {
      ...google,
      gwsClientId: "gws-cid",
      gwsClientSecret: "gws-secret",
      atlassianClientId: "atl-cid",
      atlassianClientSecret: "atl-secret",
      notionClientId: "notion-cid",
      notionClientSecret: "notion-secret",
    })
  );
  app.use(createAuthorizeRouter(dbMock, google));
  server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (typeof addr === "string" || addr === null) throw new Error("no port");
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  vi.clearAllMocks();
  clientName = "Claude";
  insertedRows.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }), { status: 200 });
      }
      if (u.startsWith("https://www.googleapis.com/oauth2/v2/userinfo")) {
        return new Response(JSON.stringify({ email: "new@example.com", name: "New" }), { status: 200 });
      }
      throw new Error(`unexpected fetch in test: ${u}`);
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function get(path: string, cookie: string) {
  return realFetch(`${base}${path}`, { redirect: "manual", headers: { cookie } });
}

const dashboardCallback = () => get("/auth/google/callback?code=c&state=n1", "login_state_nonce=n1");

function mcpCallback() {
  const state = Buffer.from(
    JSON.stringify({
      client_id: "client-1",
      redirect_uri: REDIRECT,
      code_challenge: "challenge",
      code_challenge_method: "S256",
      nonce: "n2",
    })
  ).toString("base64url");
  return get(`/oauth/callback?code=c&state=${state}`, "mcp_oauth_nonce=n2");
}

function sideEffectCounts() {
  return {
    persist: vi.mocked(persistAcquisition).mock.calls.length,
    signup: vi.mocked(trackSignup).mock.calls.length,
    welcome: vi.mocked(sendWelcomeEmail).mock.calls.length,
    leads: vi.mocked(notifySignup).mock.calls.length,
  };
}
const ONCE = { persist: 1, signup: 1, welcome: 1, leads: 1 };
const NEVER = { persist: 0, signup: 0, welcome: 0, leads: 0 };

describe("a new user from the dashboard", () => {
  it("gets every side effect once, attributed to the dashboard", async () => {
    userLookups = [[]];
    inserted = [NEW_USER];
    const res = await dashboardCallback();
    expect(res.status).toBe(302);
    expect(sideEffectCounts()).toEqual(ONCE);
    expect(vi.mocked(persistAcquisition).mock.calls[0]).toEqual([dbMock, "user-new", { utmSource: "newsletter" }]);
    expect(vi.mocked(trackSignup).mock.calls[0][5]).toEqual({ entry: "dashboard" });
    expect(vi.mocked(sendWelcomeEmail)).toHaveBeenCalledWith(expect.objectContaining({ email: "new@example.com" }));
    expect(vi.mocked(notifySignup).mock.calls[0][2]).toEqual({ entry: "dashboard" });
    expect(trackLogin).not.toHaveBeenCalled();
  });

  it("a returning user gets none of them", async () => {
    userLookups = [[OLD_USER]];
    await dashboardCallback();
    expect(sideEffectCounts()).toEqual(NEVER);
    expect(trackLogin).toHaveBeenCalledTimes(1);
  });
});

describe("a new user from an MCP client", () => {
  it("gets every side effect once, attributed to the client by its name", async () => {
    userLookups = [[]];
    inserted = [NEW_USER];
    const res = await mcpCallback();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^http:\/\/127\.0\.0\.1:9999\/callback\?code=/);
    expect(sideEffectCounts()).toEqual(ONCE);
    // No landing page: nothing to persist but the call itself.
    expect(vi.mocked(persistAcquisition).mock.calls[0]).toEqual([dbMock, "user-new", null]);
    expect(vi.mocked(trackSignup).mock.calls[0][5]).toEqual({ entry: "mcp_client", clientName: "Claude" });
    expect(vi.mocked(sendWelcomeEmail)).toHaveBeenCalledWith(expect.objectContaining({ email: "new@example.com" }));
    expect(vi.mocked(notifySignup).mock.calls[0][2]).toEqual({ entry: "mcp_client", clientName: "Claude" });
  });

  it("a registered name is the client's own claim, cleaned before it is used", async () => {
    userLookups = [[]];
    inserted = [NEW_USER];
    clientName = "Claude\n‮Code\u0007";
    await mcpCallback();
    expect(vi.mocked(trackSignup).mock.calls[0][5]).toEqual({ entry: "mcp_client", clientName: "Claude Code" });
  });

  it("a client with no name is still an MCP client signup", async () => {
    userLookups = [[]];
    inserted = [NEW_USER];
    clientName = null;
    await mcpCallback();
    expect(vi.mocked(trackSignup).mock.calls[0][5]).toEqual({ entry: "mcp_client", clientName: null });
  });

  it("a returning user gets none of them", async () => {
    userLookups = [[OLD_USER]];
    const res = await mcpCallback();
    expect(res.status).toBe(302);
    expect(sideEffectCounts()).toEqual(NEVER);
  });

  it("a sign-in that lost the race to create the row gets none of them", async () => {
    // Not there at the lookup, created by another sign-in before the insert.
    userLookups = [[], [OLD_USER]];
    inserted = [];
    const res = await mcpCallback();
    expect(res.status).toBe(302);
    expect(sideEffectCounts()).toEqual(NEVER);
  });
});

describe("findOrCreateGoogleUser", () => {
  it("is new only for the caller whose insert created the row", async () => {
    userLookups = [[]];
    inserted = [NEW_USER];
    expect(await findOrCreateGoogleUser(dbMock, { email: "new@example.com" })).toEqual({ user: NEW_USER, isNewUser: true });
    userLookups = [[OLD_USER]];
    expect(await findOrCreateGoogleUser(dbMock, { email: "new@example.com" })).toEqual({ user: OLD_USER, isNewUser: false });
    userLookups = [[], [OLD_USER]];
    inserted = [];
    expect(await findOrCreateGoogleUser(dbMock, { email: "new@example.com" })).toEqual({ user: OLD_USER, isNewUser: false });
  });
});

describe("onNewUser", () => {
  it("carries the dashboard's skill slug onto the signup event", async () => {
    await onNewUser(dbMock, NEW_USER as never, { entry: "dashboard", attribution: null, skill: "weekly-report" });
    expect(vi.mocked(trackSignup).mock.calls[0][4]).toEqual({ skill: "weekly-report" });
  });
});

/* SCRUM-443 release 1: the session token and the authorization code are
 * stored with sha256(raw) as hex beside the raw value. */
describe("the hash is written beside the raw value (SCRUM-443)", () => {
  it("for the dashboard session the login sets as the cookie", async () => {
    userLookups = [[OLD_USER]];
    const res = await dashboardCallback();
    const cookie = /dtrmcp_session=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];
    expect(cookie).toBeTruthy();
    const row = insertedRows.find((r) => r.table === oauthAccessTokens)?.v;
    expect(row?.token).toBe(cookie);
    expect(row?.tokenHash).toBe(hashToken(cookie!));
  });

  it("for the authorization code the MCP callback hands the client", async () => {
    userLookups = [[OLD_USER]];
    const res = await mcpCallback();
    const code = new URL(res.headers.get("location")!).searchParams.get("code");
    expect(code).toBeTruthy();
    const row = insertedRows.find((r) => r.table === oauthAuthorizationCodes)?.v;
    expect(row?.code).toBe(code);
    expect(row?.codeHash).toBe(hashToken(code!));
  });
});
