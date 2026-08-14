/**
 * The `next` chain through the real router (SCRUM-71): stash at /auth/google,
 * survive the Google round trip, redeem at the callback.
 *
 * Real Express over real HTTP, with only the world outside the process faked
 * (Google's token/userinfo endpoints via a stubbed fetch, the DB via the
 * usual chainable mock). A pure test of resolveNextPath proves nothing about
 * WIRING — the value dies if any of the three links drops it, and a static
 * href is exactly how it died the first time.
 */

import { createServer, type Server } from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

import { createAuthRouter } from "./auth";

const RETURNING_USER = {
  id: "user-1",
  email: "someone@example.com",
  name: "Someone",
  createdAt: new Date("2026-01-01"),
  plan: "free",
};

const selectLimit = vi.fn();
const insertReturning = vi.fn();
function insertValues() {
  // users insert chains .returning(); the token insert is awaited directly.
  return Object.assign(Promise.resolve(undefined), {
    returning: insertReturning,
  });
}
const dbMock = {
  select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }),
  insert: () => ({ values: insertValues }),
  update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
} as unknown as Database;

let server: Server;
let base: string;

// The stub below replaces globalThis.fetch for the code under test; the test
// itself still needs the real one to reach the local server.
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
      baseUrl: "http://127.0.0.1", // http => non-secure cookies, fine for a test
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
  selectLimit.mockResolvedValue([RETURNING_USER]);
  insertReturning.mockResolvedValue([RETURNING_USER]);
  // Google's two endpoints, and nothing else: any other host is a test bug.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "at" }), {
          status: 200,
        });
      }
      if (u.startsWith("https://www.googleapis.com/oauth2/v2/userinfo")) {
        return new Response(
          JSON.stringify({ email: RETURNING_USER.email, name: "Someone" }),
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

/** node's fetch follows redirects by default; every assertion here is ABOUT
 * the redirect, so it must be read raw. */
function rawGet(path: string, cookie?: string) {
  return realFetch(`${base}${path}`, {
    redirect: "manual",
    headers: cookie ? { cookie } : undefined,
  });
}

describe("the stash: GET /auth/google", () => {
  it("parks a valid next in the dtr_next cookie for the callback", async () => {
    const res = await rawGet("/auth/google?next=%2Fdashboard%2Fagent");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("accounts.google.com");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("dtr_next=%2Fdashboard%2Fagent");
    expect(setCookie).toContain("HttpOnly");
  });

  it("refuses to even stash an off-origin next", async () => {
    for (const evil of [
      "https%3A%2F%2Fevil.com",
      encodeURIComponent("//evil.com"),
      encodeURIComponent("/\\evil.com"),
    ]) {
      const res = await rawGet(`/auth/google?next=${evil}`);
      expect(res.headers.get("set-cookie") ?? "").not.toContain("dtr_next");
    }
  });
});

describe("the redemption: GET /auth/google/callback", () => {
  it("lands the login where the email link asked, and clears the stash", async () => {
    const res = await rawGet(
      "/auth/google/callback?code=x",
      "dtr_next=%2Fdashboard%2Fagent"
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/dashboard/agent?welcome=1");
    // The stash is single-use: cleared whether or not it was honoured.
    expect(res.headers.get("set-cookie")).toContain("dtr_next=;");
  });

  it("honours a next that DIFFERS from the default — the wiring cannot pass by coincidence", async () => {
    // The email-link case above expects the same URL the table would produce
    // (flag on, returning user), so on its own it stays green with the
    // redemption wiring deleted — proven by mutation, not conjectured. This
    // path only comes out of the cookie.
    const res = await rawGet(
      "/auth/google/callback?code=x",
      "dtr_next=%2Fdashboard%2Fusage"
    );
    expect(res.headers.get("location")).toBe("/dashboard/usage");
  });

  it("a new user's next that differs from the default still carries signup=1", async () => {
    selectLimit.mockResolvedValue([]);
    const res = await rawGet(
      "/auth/google/callback?code=x",
      "dtr_next=%2Fdashboard%2Fusage"
    );
    expect(res.headers.get("location")).toBe("/dashboard/usage?signup=1");
  });

  it("a new user arriving via next still gets signup=1 — conversion reporting intact", async () => {
    selectLimit.mockResolvedValue([]); // no such user yet -> signup path
    const res = await rawGet(
      "/auth/google/callback?code=x",
      "dtr_next=%2Fdashboard%2Fagent"
    );
    expect(res.headers.get("location")).toBe(
      "/dashboard/agent?signup=1&welcome=1"
    );
  });

  it("an off-origin value planted in the cookie falls back to the table, never off-origin", async () => {
    // The redemption-side validation is not redundant with the stash-side
    // one: this cookie arrives WITHOUT ever passing the stash. Weaken
    // resolveNextPath and THIS is the test that goes red.
    for (const evil of [
      encodeURIComponent("//evil.com"),
      encodeURIComponent("https://evil.com/dashboard"),
      encodeURIComponent("/\\evil.com"),
    ]) {
      const res = await rawGet(
        "/auth/google/callback?code=x",
        `dtr_next=${evil}`
      );
      const location = res.headers.get("location") ?? "";
      expect(location).toBe("/dashboard/agent?welcome=1");
      expect(location).not.toContain("evil.com");
    }
  });

  it("no stash at all falls through to the unchanged table", async () => {
    const res = await rawGet("/auth/google/callback?code=x");
    expect(res.headers.get("location")).toBe("/dashboard/agent?welcome=1");
  });
});
