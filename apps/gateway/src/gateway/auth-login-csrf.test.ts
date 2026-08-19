/**
 * SCRUM-124: the dashboard LOGIN round trip must be bound to the browser that
 * began it.
 *
 * Login was the ONE OAuth-initiating flow in this codebase that bound nothing:
 * `/auth/google` built the Google URL with no `state`, and the callback
 * exchanged any `code` that arrived. Every sibling (the GWS/Atlassian/plugin
 * connects, the gateway's own authorize endpoint) already echoes a one-shot
 * httpOnly nonce as `state` and requires it to match at the callback. These
 * tests hold login to the same contract, through the REAL router over real
 * HTTP — a unit test of nonceMatches proves nothing about the wiring.
 *
 * The pin that actually stops the regression is the token-exchange one: on
 * every rejection path the stubbed fetch must never be called at all. Test 1
 * (URL carries state) stays green under a refactor that drops the callback
 * check; test 2 (callback REFUSES missing and REFUSES mismatched, exchange
 * unreached) is the one that catches it. An ABSENT state is a rejection, not
 * "no binding requested".
 */

import { createServer, type Server } from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Database } from "@datatorag-mcp/db";

vi.mock("@datatorag-mcp/config", () => ({
  getEnv: () => ({ AGENT_DEFAULT_VIEW: "off" }),
}));
vi.mock("./track", () => ({
  trackLogin: vi.fn(),
  trackSignup: vi.fn(),
  trackOAuthCompleted: vi.fn(async () => undefined),
}));
vi.mock("./attribution", () => ({
  stashAttribution: vi.fn(),
  takeAttribution: vi.fn(() => null),
  persistAcquisition: vi.fn(async () => undefined),
}));
vi.mock("./lifecycle", () => ({
  sendWelcomeEmail: vi.fn(async () => undefined),
}));
vi.mock("./signup-alert", () => ({
  notifySignup: vi.fn(async () => undefined),
}));

import { createAuthRouter } from "./auth";

const selectLimit = vi.fn();
const insertReturning = vi.fn(async () => [
  { id: "user-1", email: "acct@example.com", name: null, plan: "free", createdAt: new Date() },
]);
const dbMock = {
  select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }),
  insert: () => ({
    values: () => ({ returning: insertReturning, then: (r: () => void) => Promise.resolve().then(r) }),
  }),
  update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
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
  // A returning user exists, so the callback takes the login (not signup) path.
  selectLimit.mockResolvedValue([
    { id: "user-1", email: "acct@example.com", name: null, plan: "free", createdAt: new Date() },
  ]);
  vi.stubGlobal(
    "fetch",
    outbound.mockImplementation(async (url: string | URL) => {
      const u = String(url);
      if (u.startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({ access_token: "at", expires_in: 3600 }),
          { status: 200 }
        );
      }
      if (u.startsWith("https://www.googleapis.com/oauth2/v2/userinfo")) {
        return new Response(
          JSON.stringify({ email: "acct@example.com", name: "Acct" }),
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

function rawGet(path: string, cookie?: string) {
  return realFetch(`${base}${path}`, {
    redirect: "manual",
    headers: cookie ? { cookie } : undefined,
  });
}

/** Whether the code under test ever spoke to Google's token endpoint. */
function exchangeAttempted(): boolean {
  return outbound.mock.calls.some((c) =>
    String(c[0]).startsWith("https://oauth2.googleapis.com/token")
  );
}

describe("the binding: GET /auth/google", () => {
  it("sends a state nonce to Google and parks the SAME nonce in an httpOnly cookie", async () => {
    const res = await rawGet("/auth/google");
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.hostname).toBe("accounts.google.com");
    const state = location.searchParams.get("state");
    expect(state).toBeTruthy();

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`login_state_nonce=${state}`);
    expect(setCookie).toContain("HttpOnly");
  });

  it("mints a fresh nonce per initiation, never a fixed value", async () => {
    const first = new URL(
      (await rawGet("/auth/google")).headers.get("location") ?? ""
    ).searchParams.get("state");
    const second = new URL(
      (await rawGet("/auth/google")).headers.get("location") ?? ""
    ).searchParams.get("state");
    expect(first).not.toBe(second);
  });
});

describe("the gate: GET /auth/google/callback", () => {
  it("rejects a callback with NO state, and never reaches the token exchange", async () => {
    // The absent-state case: this is the whole point — omitting the parameter
    // must not read as "no binding requested" and fall through.
    const res = await rawGet(
      "/auth/google/callback?code=attacker-code",
      "login_state_nonce=n1"
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/auth/login?error=invalid_state");
    // THE PIN THAT PROVES THE FIX: the attacker's code was never exchanged.
    expect(exchangeAttempted()).toBe(false);
  });

  it("rejects a state that does not match the cookie, exchange unreached", async () => {
    const res = await rawGet(
      "/auth/google/callback?code=attacker-code&state=n2",
      "login_state_nonce=n1"
    );
    expect(res.headers.get("location")).toBe("/auth/login?error=invalid_state");
    expect(exchangeAttempted()).toBe(false);
  });

  it("rejects a callback with no nonce cookie at all — the forced-link attack shape", async () => {
    // The attack verbatim: a victim's browser that never began a login loads a
    // link carrying the attacker's code and a state of the attacker's choosing.
    const res = await rawGet(
      "/auth/google/callback?code=attacker-code&state=n1"
    );
    expect(res.headers.get("location")).toBe("/auth/login?error=invalid_state");
    expect(exchangeAttempted()).toBe(false);
  });

  it("completes with a matching state and retires the nonce so it cannot be replayed", async () => {
    const res = await rawGet(
      "/auth/google/callback?code=real-code&state=n1",
      "login_state_nonce=n1"
    );
    // A completed login sets the session cookie and redirects into the product,
    // not back to /auth/login.
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).not.toContain("/auth/login");
    expect(exchangeAttempted()).toBe(true);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("dtrmcp_session=");

    // One-shot: the nonce cookie is cleared by the response.
    expect(setCookie).toContain("login_state_nonce=;");

    // And a replay as the browser would now send it (no nonce cookie) is refused.
    outbound.mockClear();
    const replay = await rawGet(
      "/auth/google/callback?code=real-code&state=n1"
    );
    expect(replay.headers.get("location")).toBe(
      "/auth/login?error=invalid_state"
    );
    expect(exchangeAttempted()).toBe(false);
  });

  it("clears the one-shot nonce cookie on the FAILURE paths too", async () => {
    const res = await rawGet(
      "/auth/google/callback?code=c&state=n2",
      "login_state_nonce=n1"
    );
    expect(res.headers.get("set-cookie") ?? "").toContain("login_state_nonce=;");
  });

  it("clears the dtr_next stash on a state rejection, so it cannot ride into the next flow", async () => {
    // The state guard adds a new early return; the one-shot next stash must be
    // consumed on it too, the same discipline the connect callback keeps. A
    // stash surviving a rejected callback could re-route a later, unrelated
    // login within its TTL.
    const res = await rawGet(
      "/auth/google/callback?code=c&state=n2",
      "login_state_nonce=n1; dtr_next=%2Fdashboard%2Fusage"
    );
    expect(res.headers.get("location")).toBe("/auth/login?error=invalid_state");
    expect(res.headers.get("set-cookie") ?? "").toContain("dtr_next=;");
  });
});
