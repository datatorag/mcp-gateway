/**
 * SCRUM-136, THE PIN: a partial scope grant must never be recorded as a clean
 * connection.
 *
 * Google's consent screen lets a user untick individual scopes. Before this,
 * the connect callback recorded `account_connected` identically for a full
 * grant and for a grant with every Workspace scope removed — and the gap was
 * invisible because every internal account holds a full grant, so nothing
 * internal ever exercised the partial path. That is exactly why this is a
 * test and not a habit: the regression re-hides itself the moment the
 * callback is touched. (Per HQ decision, see SCRUM-136.)
 *
 * Through the REAL router over real HTTP, like its sibling
 * auth-connect-csrf.test.ts, whose harness this reuses.
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
const trackOAuthCompleted = vi.fn(async (..._args: unknown[]) => undefined);
const trackConnectRefused = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("./track", () => ({
  trackLogin: vi.fn(),
  trackSignup: vi.fn(),
  trackOAuthCompleted: (...args: unknown[]) => trackOAuthCompleted(...args),
  trackConnectRefused: (...args: unknown[]) => trackConnectRefused(...args),
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
const upsertServiceAccount = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("./connected-accounts", () => ({
  upsertServiceAccount: (...args: unknown[]) => upsertServiceAccount(...args),
}));

import { createAuthRouter } from "./auth";
import { GWS_SCOPE_LIST } from "./scope-grant";

const selectLimit = vi.fn();
const dbMock = {
  select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }),
  insert: () => ({ values: () => Promise.resolve() }),
  update: () => ({
    set: (values: Record<string, unknown>) => {
      updates.push(values);
      return { where: () => (updateFails ? Promise.reject(new Error("db down")) : Promise.resolve()) };
    },
  }),
} as unknown as Database;

/** Every `set(...)` the code under test issued, in order. */
const updates: Array<Record<string, unknown>> = [];
let updateFails = false;

let server: Server;
let base: string;

const realFetch = globalThis.fetch;
const outbound = vi.fn();

/** What the token exchange will report as granted; set per test. */
let grantedScope: string | undefined;
/** The id_token the exchange returns, when a test wants one. */
let idToken: string | undefined;

/** An unsigned id_token carrying these claims, in Google's three-part shape. */
function idTokenFor(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part(claims)}.signature`;
}

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
  grantedScope = undefined;
  idToken = undefined;
  updates.length = 0;
  updateFails = false;
  selectLimit.mockResolvedValue([{ userId: "user-1" }]);
  vi.stubGlobal(
    "fetch",
    outbound.mockImplementation(async (url: string | URL) => {
      const u = String(url);
      if (u.startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({
            access_token: "at",
            expires_in: 3600,
            ...(grantedScope !== undefined ? { scope: grantedScope } : {}),
            ...(idToken !== undefined ? { id_token: idToken } : {}),
          }),
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

function callback(cookie: string) {
  return realFetch(`${base}/auth/google/connect/callback?code=c&state=n1`, {
    redirect: "manual",
    headers: { cookie },
  });
}

const BOUND = "dtrmcp_session=sess-1; gws_connect_nonce=n1";

function get(path: string, cookie?: string) {
  return realFetch(`${base}${path}`, {
    redirect: "manual",
    headers: cookie ? { cookie } : undefined,
  });
}

/** The grant delta the callback handed to trackOAuthCompleted (arg index 5). */
function trackedGrant():
  | { complete: boolean; missing: Array<{ displayName: string }> }
  | undefined {
  return trackOAuthCompleted.mock.calls[0]?.[5] as
    | { complete: boolean; missing: Array<{ displayName: string }> }
    | undefined;
}

describe("the SCRUM-149 gate: a zero-service grant is a failed connect, not a connection", () => {
  it("identity-only grant: nothing is written, no connected event, distinct error code", async () => {
    grantedScope = "https://www.googleapis.com/auth/userinfo.email openid";
    const res = await callback(BOUND);

    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    // A grant that can serve zero tools is refused outright. Recording it as
    // a connection is what SCRUM-136 documented and SCRUM-149 ends: the row
    // poisoned the connections page, the lifecycle cron and the follow-up
    // email, and (SCRUM-145) could hold the default forever.
    // SCRUM-410: it lands on the page that names what to tick, in its
    // refused form, and nowhere that could read as a connection.
    expect(location).toBe("/auth/google/connect?refused=1");
    expect(location).not.toContain("connected=");
    expect(location).not.toContain("partial=");
    expect(upsertServiceAccount).not.toHaveBeenCalled();
    // The funnel event keeps its meaning: a refused connect is not a
    // connection, so account_connected must not fire — the refusal has its
    // own event so instrumentation still sees it.
    expect(trackOAuthCompleted).not.toHaveBeenCalled();
    expect(trackConnectRefused).toHaveBeenCalledTimes(1);
  });

  it("a refused connect started from a thread returns to that thread with the code", async () => {
    grantedScope = "https://www.googleapis.com/auth/userinfo.email openid";
    const res = await callback(
      `${BOUND}; dtr_connect_next=${encodeURIComponent("/dashboard/agent?thread=t1")}`
    );

    // The refused page carries the thread, so Try again returns to it...
    const location = res.headers.get("location") ?? "";
    expect(location).toBe(
      `/auth/google/connect?refused=1&next=${encodeURIComponent("/dashboard/agent?thread=t1")}`
    );
    expect(upsertServiceAccount).not.toHaveBeenCalled();

    // ...and its "back" link is the destination a refusal used to land on:
    // the thread, with the code that makes it say what happened.
    const page = await (await get(location, "dtrmcp_session=sess-1")).text();
    const back = page.match(/class="cancel" href="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&") ?? "";
    expect(back).toContain("/dashboard/agent");
    expect(back).toContain("thread=t1");
    expect(back).toContain("connect_error=no_services_granted");
  });

  describe("what a refused connect does for the person it happened to (SCRUM-410)", () => {
    const ZERO = "https://www.googleapis.com/auth/userinfo.email openid";
    const setCookies = (res: Response) => res.headers.getSetCookie();
    const hintCookie = (res: Response) => setCookies(res).find((c) => c.startsWith("gws_connect_hint="));

    it("brings the note under the connect button back", async () => {
      grantedScope = ZERO;
      await callback(BOUND);
      expect(updates).toEqual([{ connectHelperDismissedAt: null }]);
    });

    it("still lands on the refused page when that write fails", async () => {
      grantedScope = ZERO;
      updateFails = true;
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await callback(BOUND);
      expect(res.headers.get("location")).toBe("/auth/google/connect?refused=1");
      expect(errors).toHaveBeenCalled();
    });

    it("does not touch the note for a connect that granted something", async () => {
      grantedScope = `${ZERO} https://www.googleapis.com/auth/gmail.modify`;
      await callback(BOUND);
      expect(updates).toEqual([]);
    });

    it("remembers the account that was tried, in an httpOnly cookie and never in the URL", async () => {
      grantedScope = ZERO;
      idToken = idTokenFor({ email: "tried@example.com", sub: "1" });
      const res = await callback(BOUND);

      const cookie = hintCookie(res) ?? "";
      expect(cookie).toContain(`gws_connect_hint=${encodeURIComponent("tried@example.com")}`);
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toMatch(/Max-Age=\d+/);
      expect(res.headers.get("location")).not.toContain("tried");
      // Still no identity lookup for a connection that was refused.
      expect(outbound.mock.calls.some((c) => String(c[0]).includes("userinfo"))).toBe(false);
    });

    it("remembers nothing when the token carries no usable address", async () => {
      grantedScope = ZERO;
      for (const token of [undefined, "not-a-jwt", idTokenFor({ sub: "1" }), idTokenFor({ email: "a b@x" }), idTokenFor({ email: '"><x@y.z' })]) {
        idToken = token;
        const res = await callback(BOUND);
        expect(hintCookie(res), String(token)).toBeUndefined();
      }
    });

    it("the refused page says what happened, names the services, and offers Try again", async () => {
      const res = await get("/auth/google/connect?refused=1", "dtrmcp_session=sess-1");
      expect(res.status).toBe(200);
      const page = await res.text();
      expect(page).toContain("Google connected nothing");
      expect(page).toContain("Select all");
      for (const name of ["Gmail", "Drive", "Calendar", "Docs", "Sheets", "Slides", "Contacts", "Tasks"]) {
        expect(page, name).toContain(name);
      }
      expect(page).toContain('href="/auth/google/connect?proceed=1&retry=1"');
      expect(page).toContain(">Try again<");
      // Back goes to the dashboard leg, still carrying the refusal.
      expect(page).toContain('class="cancel" href="/dashboard/connections?error=no_services_granted"');
      // Nothing was started by looking at a page.
      expect(setCookies(res).some((c) => c.startsWith("gws_connect_nonce="))).toBe(false);
    });

    it("the refused page drops a return path that is not ours", async () => {
      const page = await (
        await get(`/auth/google/connect?refused=1&next=${encodeURIComponent("https://evil.example/x")}`, "dtrmcp_session=sess-1")
      ).text();
      expect(page).not.toContain("evil.example");
      expect(page).toContain('href="/auth/google/connect?proceed=1&retry=1"');
    });

    it("the refused page is behind the session like the rest of the flow", async () => {
      const res = await get("/auth/google/connect?refused=1");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/auth/login");
    });

    it("Try again goes straight to consent for that account, and spends the hint", async () => {
      const res = await get(
        "/auth/google/connect?proceed=1&retry=1",
        `dtrmcp_session=sess-1; gws_connect_hint=${encodeURIComponent("tried@example.com")}`
      );
      const google = new URL(res.headers.get("location") ?? "");
      expect(google.hostname).toBe("accounts.google.com");
      expect(google.searchParams.get("login_hint")).toBe("tried@example.com");
      // No account chooser: that was the "sign in all over again".
      expect(google.searchParams.get("prompt")).toBe("consent");
      // The whole scope set is still asked for.
      expect(google.searchParams.get("scope")).toBe(GWS_SCOPE_LIST.join(" "));
      expect(hintCookie(res)).toMatch(/gws_connect_hint=;/);
    });

    it("an ordinary Connect ignores a leftover hint, offers the chooser, and clears it", async () => {
      const res = await get(
        "/auth/google/connect?proceed=1",
        `dtrmcp_session=sess-1; gws_connect_hint=${encodeURIComponent("tried@example.com")}`
      );
      const google = new URL(res.headers.get("location") ?? "");
      expect(google.searchParams.has("login_hint")).toBe(false);
      expect(google.searchParams.get("prompt")).toBe("consent select_account");
      expect(hintCookie(res)).toMatch(/gws_connect_hint=;/);
    });

    it("signing out takes the remembered account with it", async () => {
      const res = await realFetch(`${base}/auth/logout`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie: `dtrmcp_session=sess-1; gws_connect_hint=${encodeURIComponent("tried@example.com")}` },
      });
      expect(res.status).toBe(302);
      expect(hintCookie(res)).toMatch(/gws_connect_hint=;/);
    });

    it("Try again with a hint that is not an address sends none", async () => {
      const res = await get(
        "/auth/google/connect?proceed=1&retry=1",
        `dtrmcp_session=sess-1; gws_connect_hint=${encodeURIComponent('x" onload="y')}`
      );
      const google = new URL(res.headers.get("location") ?? "");
      expect(google.searchParams.has("login_hint")).toBe(false);
      expect(google.searchParams.get("prompt")).toBe("consent select_account");
    });
  });

  it("a single granted service is NOT refused — the gate is for zero, never for narrow", async () => {
    grantedScope =
      "https://www.googleapis.com/auth/userinfo.email openid " +
      "https://www.googleapis.com/auth/gmail.modify";
    const res = await callback(BOUND);

    const location = res.headers.get("location") ?? "";
    expect(location).toContain("connected=google-workspace");
    // Stored: the granted subset genuinely works, and the tokens have to
    // live somewhere for it to.
    expect(upsertServiceAccount).toHaveBeenCalled();
    expect(trackConnectRefused).not.toHaveBeenCalled();
  });

  it("one unticked scope: exactly that scope is named", async () => {
    grantedScope = GWS_SCOPE_LIST.filter((s) => !s.includes("gmail.modify"))
      .map((s) =>
        s === "email" ? "https://www.googleapis.com/auth/userinfo.email" : s
      )
      .join(" ");
    const res = await callback(BOUND);

    const location = res.headers.get("location") ?? "";
    expect(location).toContain("partial=google-workspace");
    expect(location).toContain("missing=Gmail");

    const grant = trackedGrant();
    expect(grant?.complete).toBe(false);
    expect(grant?.missing.map((m) => m.displayName)).toEqual(["Gmail"]);
  });

  it("full grant in Google's returned spelling stays CLEAN — the alias pin", async () => {
    // Google returns userinfo.email long-form for our short-form `email`
    // request. If normalization breaks, this healthy-grant shape reads
    // partial and every full-grant user starts seeing reconnect nags.
    grantedScope = GWS_SCOPE_LIST.map((s) =>
      s === "email" ? "https://www.googleapis.com/auth/userinfo.email" : s
    ).join(" ");
    const res = await callback(BOUND);

    expect(res.headers.get("location")).toBe(
      "/dashboard/connections?connected=google-workspace"
    );
    const grant = trackedGrant();
    expect(grant?.complete).toBe(true);
    expect(grant?.missing).toEqual([]);
  });

  it("no scope field at all reads complete — fail-open, never a false nag, never refused", async () => {
    grantedScope = undefined;
    const res = await callback(BOUND);
    expect(res.headers.get("location")).toBe(
      "/dashboard/connections?connected=google-workspace"
    );
    expect(trackedGrant()?.complete).toBe(true);
    // The SCRUM-149 gate refuses only a grant POSITIVELY OBSERVED to cover
    // zero services. A response we could not read is stored, exactly as
    // before — refusing it would lock out working connections.
    expect(upsertServiceAccount).toHaveBeenCalled();
    expect(trackConnectRefused).not.toHaveBeenCalled();
  });
});
