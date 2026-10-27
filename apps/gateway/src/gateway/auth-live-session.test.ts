/**
 * SCRUM-374: every route that reads the dashboard cookie asks one question,
 * "is this a live web session", through `liveWebSessionUserId`. What a live
 * web session IS (not revoked, not expired, client id `web`) is pinned on
 * real Postgres in `lib/web-session.db.test.ts`; this file pins that each
 * connect route asks it, and that a "no" sends the browser to sign in with
 * nothing exchanged, stored or written.
 *
 * Through the REAL router over real HTTP, with the cookie present, so the
 * old presence-only check would have let each request through.
 */

import { createServer, type Server } from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@datatorag-mcp/db";

vi.mock("./track", () => ({
  trackLogin: vi.fn(),
  trackSignup: vi.fn(),
  trackOAuthCompleted: vi.fn(async () => undefined),
  trackConnectDuplicate: vi.fn(async () => undefined),
}));
vi.mock("./attribution", () => ({
  stashAttribution: vi.fn(),
  takeAttribution: vi.fn(() => null),
  persistAcquisition: vi.fn(async () => undefined),
}));
const upsertServiceAccount = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("./connected-accounts", () => ({
  upsertServiceAccount: (...args: unknown[]) => upsertServiceAccount(...args),
  connectedElsewhere: async () => null,
}));
vi.mock("./service-launch", () => ({ isServiceLaunched: async () => true }));
const liveWebSessionUserId = vi.fn(async (..._args: unknown[]): Promise<string | null> => null);
vi.mock("../lib/web-session", () => ({
  WEB_SESSION_CLIENT_ID: "web",
  liveWebSessionUserId: (...args: unknown[]) => liveWebSessionUserId(...args),
}));

import { createAuthRouter } from "./auth";

const writes = vi.fn();
const dbMock = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
  insert: () => ({ values: (v: unknown) => (writes("insert", v), Promise.resolve()) }),
  update: () => ({ set: (v: unknown) => ({ where: () => (writes("update", v), Promise.resolve()) }) }),
} as unknown as Database;

let server: Server;
let base: string;
const realFetch = globalThis.fetch;
const outbound = vi.fn();

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

beforeEach(() => {
  vi.clearAllMocks();
  liveWebSessionUserId.mockResolvedValue(null);
  vi.stubGlobal("fetch", outbound.mockImplementation(async () => new Response("{}", { status: 200 })));
});

function send(method: "GET" | "POST", path: string, cookie: string) {
  return realFetch(`${base}${path}`, { method, redirect: "manual", headers: { cookie } });
}

const SESSION = "dtrmcp_session=a-token-that-is-not-a-live-web-session";

const ROUTES: Array<{ name: string; method: "GET" | "POST"; path: string; cookie: string; status: number }> = [
  { name: "Google connect start", method: "GET", path: "/auth/google/connect?proceed=1", cookie: SESSION, status: 302 },
  { name: "Atlassian connect start", method: "GET", path: "/auth/atlassian/connect", cookie: SESSION, status: 302 },
  { name: "Notion connect start", method: "GET", path: "/auth/notion/connect", cookie: SESSION, status: 302 },
  {
    name: "Google connect callback",
    method: "GET",
    path: "/auth/google/connect/callback?code=c&state=n1",
    cookie: `${SESSION}; gws_connect_nonce=n1`,
    status: 302,
  },
  {
    name: "Atlassian connect callback",
    method: "GET",
    path: "/auth/atlassian/connect/callback?code=c&state=n1",
    cookie: `${SESSION}; atl_connect_nonce=n1`,
    status: 302,
  },
  {
    name: "Notion connect callback",
    method: "GET",
    path: "/auth/notion/connect/callback?code=c&state=n1",
    cookie: `${SESSION}; notion_connect_nonce=n1`,
    status: 302,
  },
  { name: "connect anyway", method: "POST", path: "/auth/connect/anyway?provider=google", cookie: SESSION, status: 303 },
];

describe("a cookie that is not a live web session goes to sign in (SCRUM-374)", () => {
  it.each(ROUTES)("$name", async ({ method, path, cookie, status }) => {
    const res = await send(method, path, cookie);
    expect(res.status).toBe(status);
    expect(res.headers.get("location")).toBe("/auth/login");
    expect(liveWebSessionUserId).toHaveBeenCalledWith(dbMock, "a-token-that-is-not-a-live-web-session");
    // Nothing exchanged with a provider, nothing stored, nothing written.
    expect(outbound).not.toHaveBeenCalled();
    expect(upsertServiceAccount).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
  });

  it("a live web session gets past the check (the Google start reaches the provider redirect)", async () => {
    liveWebSessionUserId.mockResolvedValue("user-1");
    const res = await send("GET", "/auth/google/connect?proceed=1", SESSION);
    expect(res.headers.get("location") ?? "").toMatch(/^https:\/\/accounts\.google\.com\//);
  });
});
