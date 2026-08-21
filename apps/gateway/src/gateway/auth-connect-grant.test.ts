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
vi.mock("./track", () => ({
  trackLogin: vi.fn(),
  trackSignup: vi.fn(),
  trackOAuthCompleted: (...args: unknown[]) => trackOAuthCompleted(...args),
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
  update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
} as unknown as Database;

let server: Server;
let base: string;

const realFetch = globalThis.fetch;
const outbound = vi.fn();

/** What the token exchange will report as granted; set per test. */
let grantedScope: string | undefined;

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

/** The grant delta the callback handed to trackOAuthCompleted (arg index 5). */
function trackedGrant():
  | { complete: boolean; missing: Array<{ displayName: string }> }
  | undefined {
  return trackOAuthCompleted.mock.calls[0]?.[5] as
    | { complete: boolean; missing: Array<{ displayName: string }> }
    | undefined;
}

describe("the pin: a partial grant is not recorded clean", () => {
  it("identity-only grant: event carries grant_complete=false naming all eight, redirect names them", async () => {
    grantedScope = "https://www.googleapis.com/auth/userinfo.email openid";
    const res = await callback(BOUND);

    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("connected=google-workspace");
    expect(location).toContain("partial=google-workspace");
    expect(location).toContain("missing=");

    const grant = trackedGrant();
    expect(grant?.complete).toBe(false);
    expect(grant?.missing.map((m) => m.displayName).sort()).toEqual([
      "Calendar",
      "Contacts",
      "Docs",
      "Drive",
      "Gmail",
      "Sheets",
      "Slides",
      "Tasks",
    ]);

    // The row IS still stored: the granted subset genuinely works, and the
    // tokens have to live somewhere for it to.
    expect(upsertServiceAccount).toHaveBeenCalled();
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

  it("no scope field at all reads complete — fail-open, never a false nag", async () => {
    grantedScope = undefined;
    const res = await callback(BOUND);
    expect(res.headers.get("location")).toBe(
      "/dashboard/connections?connected=google-workspace"
    );
    expect(trackedGrant()?.complete).toBe(true);
  });
});
