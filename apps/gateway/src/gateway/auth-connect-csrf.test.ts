/**
 * SCRUM-86: the Google Workspace CONNECT round trip must be bound to the
 * browser that began it.
 *
 * Every other OAuth-initiating flow in this codebase already binds its round
 * trip with the shared nonce helper (Atlassian connect, plugin connect, the
 * gateway's own authorize endpoint) — an httpOnly nonce echoed as `state` and
 * required to match at the callback. This flow did not, and these tests hold
 * it to the same contract, through the REAL router over real HTTP: a unit test
 * of nonceMatches proves nothing about wiring.
 *
 * The pin that actually proves the binding is the token-exchange one: on every
 * rejection path the stubbed fetch must never be called at all. Rejecting only
 * by response code would let the exchange happen first, which is the property
 * that matters. (Threat detail lives in the private tracker, not here.)
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
  getEnv: () => ({ AGENT_DEFAULT_VIEW: "on" }),
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
const upsertServiceAccount = vi.fn(async () => undefined);
vi.mock("./connected-accounts", () => ({
  upsertServiceAccount: () => upsertServiceAccount(),
}));

import { createAuthRouter } from "./auth";
import { GWS_SCOPE_LIST } from "./scope-grant";

const selectLimit = vi.fn();
const dbMock = {
  select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }),
  insert: () => ({ values: () => Promise.resolve() }),
  update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
} as unknown as Database;

let server: Server;
let base: string;

const realFetch = globalThis.fetch;
/** Stub for the code under test's OUTBOUND calls. Any call at all on a
 * rejection path is the defect. */
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
  // The session row the callback resolves the user from.
  selectLimit.mockResolvedValue([{ userId: "user-1" }]);
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
        return new Response(JSON.stringify({ email: "acct@example.com" }), {
          status: 200,
        });
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

const SESSION = "dtrmcp_session=sess-1";

describe("the binding: GET /auth/google/connect", () => {
  it("sends a state nonce to Google and parks the SAME nonce in an httpOnly cookie", async () => {
    const res = await rawGet("/auth/google/connect?proceed=1", SESSION);
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.hostname).toBe("accounts.google.com");
    const state = location.searchParams.get("state");
    expect(state).toBeTruthy();

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`gws_connect_nonce=${state}`);
    expect(setCookie).toContain("HttpOnly");
  });

  it("mints a fresh nonce per initiation, never a fixed value", async () => {
    const first = new URL(
      (await rawGet("/auth/google/connect?proceed=1", SESSION)).headers.get("location") ?? ""
    ).searchParams.get("state");
    const second = new URL(
      (await rawGet("/auth/google/connect?proceed=1", SESSION)).headers.get("location") ?? ""
    ).searchParams.get("state");
    expect(first).not.toBe(second);
  });
});

/**
 * SCRUM-150: the interstitial before the handoff to Google. The failure it
 * exists to prevent happens on Google's screen, where we control nothing —
 * granular consent brings the service checkboxes up unticked, and the
 * Continue gesture that sign-in just taught grants zero services (the state
 * SCRUM-149 now refuses to record). The moment before the redirect is the
 * only lever we hold, so every path to Google passes through this page.
 */
describe("the interstitial: GET /auth/google/connect without proceed", () => {
  it("renders the instruction page instead of redirecting, naming Select all", async () => {
    const res = await rawGet("/auth/google/connect", SESSION);
    expect(res.status).toBe(200);
    const html = await res.text();
    // The single control that separates a working connection from a dead one
    // is called out by name.
    expect(html).toContain("Select all");
    // The continue control carries the proceed flag.
    expect(html).toContain("/auth/google/connect?proceed=1");
    // No OAuth state is minted for a page view: the nonce is one-shot and
    // belongs to the actual handoff.
    expect(res.headers.get("set-cookie") ?? "").not.toContain(
      "gws_connect_nonce"
    );
  });

  it("carries the next path through to the proceed leg, encoded", async () => {
    const res = await rawGet(
      `/auth/google/connect?next=${encodeURIComponent("/dashboard/agent?thread=t1")}`,
      SESSION
    );
    const html = await res.text();
    expect(html).toContain(
      `/auth/google/connect?proceed=1&next=${encodeURIComponent("/dashboard/agent?thread=t1")}`
    );
  });

  it("still requires a session, exactly like the redirect leg", async () => {
    const res = await rawGet("/auth/google/connect");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/auth/login");
  });

  it("the proceed leg still requests the FULL scope set — the gate is never 'ask for less'", async () => {
    // Per HQ decision on the SCRUM-136 dispatch, reaffirmed on SCRUM-149:
    // the fix for consent drop-off is instruction and honest recording,
    // never silently narrowing the request.
    const res = await rawGet("/auth/google/connect?proceed=1", SESSION);
    const location = new URL(res.headers.get("location") ?? "");
    const scope = location.searchParams.get("scope") ?? "";
    for (const s of GWS_SCOPE_LIST) {
      expect(scope).toContain(s);
    }
  });

  it("Atlassian connect is untouched: no interstitial, straight to the provider", async () => {
    const res = await rawGet("/auth/atlassian/connect", SESSION);
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.hostname).toBe("auth.atlassian.com");
  });
});

describe("the gate: GET /auth/google/connect/callback", () => {
  it("rejects a callback with NO state, and never reaches the token exchange", async () => {
    const res = await rawGet(
      "/auth/google/connect/callback?code=attacker-code",
      `${SESSION}; gws_connect_nonce=n1`
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "/dashboard/connections?error=invalid_state"
    );
    // THE PIN THAT PROVES THE FIX: the attacker's code was never exchanged.
    expect(exchangeAttempted()).toBe(false);
    expect(upsertServiceAccount).not.toHaveBeenCalled();
  });

  it("rejects a state that does not match the cookie, exchange unreached", async () => {
    const res = await rawGet(
      "/auth/google/connect/callback?code=attacker-code&state=n2",
      `${SESSION}; gws_connect_nonce=n1`
    );
    expect(res.headers.get("location")).toBe(
      "/dashboard/connections?error=invalid_state"
    );
    expect(exchangeAttempted()).toBe(false);
    expect(upsertServiceAccount).not.toHaveBeenCalled();
  });

  it("rejects a callback with no nonce cookie at all — the forced-link attack shape", async () => {
    // This is the attack verbatim: a victim's browser, holding a valid
    // session but never having started a connect, loads a link carrying the
    // attacker's code and a state of the attacker's choosing.
    const res = await rawGet(
      "/auth/google/connect/callback?code=attacker-code&state=n1",
      SESSION
    );
    expect(res.headers.get("location")).toBe(
      "/dashboard/connections?error=invalid_state"
    );
    expect(exchangeAttempted()).toBe(false);
    expect(upsertServiceAccount).not.toHaveBeenCalled();
  });

  it("completes with a matching state, and retires the nonce so it cannot be replayed", async () => {
    const res = await rawGet(
      "/auth/google/connect/callback?code=real-code&state=n1",
      `${SESSION}; gws_connect_nonce=n1`
    );
    expect(res.headers.get("location")).toBe(
      "/dashboard/connections?connected=google-workspace"
    );
    expect(exchangeAttempted()).toBe(true);
    expect(upsertServiceAccount).toHaveBeenCalled();

    // One-shot: the cookie is cleared by the response, so the browser cannot
    // present this nonce again within its TTL.
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("gws_connect_nonce=;");

    // And a replay as the browser would now send it (no cookie) is refused.
    outbound.mockClear();
    const replay = await rawGet(
      "/auth/google/connect/callback?code=real-code&state=n1",
      SESSION
    );
    expect(replay.headers.get("location")).toBe(
      "/dashboard/connections?error=invalid_state"
    );
    expect(exchangeAttempted()).toBe(false);
  });

  it("clears the one-shot nonce cookie on the FAILURE paths too", async () => {
    // A nonce surviving a failed callback could be replayed within its TTL.
    const res = await rawGet(
      "/auth/google/connect/callback?code=c&state=n2",
      `${SESSION}; gws_connect_nonce=n1`
    );
    expect(res.headers.get("set-cookie") ?? "").toContain("gws_connect_nonce=;");
  });
});
