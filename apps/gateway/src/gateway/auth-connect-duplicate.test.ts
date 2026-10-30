/**
 * SCRUM-363: a connect of an account already held by another DataToRAG user,
 * through the REAL router over real HTTP.
 *
 * What must hold: on a duplicate nothing is stored and the warning page names
 * the other user only by a masked address; "Connect it here anyway" is
 * honoured only through the one-shot acknowledgement bound to the next
 * connect's nonce, never through anything a link can carry.
 */

import { createServer, type Server } from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@datatorag-mcp/db";

const trackConnectDuplicate = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("./track", () => ({
  trackConnectLinkEvent: vi.fn(async () => undefined),
  trackLogin: vi.fn(),
  trackSignup: vi.fn(),
  trackOAuthCompleted: vi.fn(async () => undefined),
  trackConnectDuplicate: (...args: unknown[]) => trackConnectDuplicate(...args),
}));
vi.mock("./attribution", () => ({
  stashAttribution: vi.fn(),
  takeAttribution: vi.fn(() => null),
  persistAcquisition: vi.fn(async () => undefined),
}));
vi.mock("./lifecycle", () => ({ sendWelcomeEmail: vi.fn(async () => undefined) }));
vi.mock("./signup-alert", () => ({ notifySignup: vi.fn(async () => undefined) }));
const upsertServiceAccount = vi.fn(async (..._args: unknown[]) => undefined);
const connectedElsewhere = vi.fn(async (..._args: unknown[]): Promise<{ otherSignIn: string } | null> => null);
vi.mock("./connected-accounts", () => ({
  upsertServiceAccount: (...args: unknown[]) => upsertServiceAccount(...args),
  connectedElsewhere: (...args: unknown[]) => connectedElsewhere(...args),
}));
vi.mock("./service-launch", () => ({ isServiceLaunched: vi.fn(async () => true) }));

import { createAuthRouter } from "./auth";

const selectLimit = vi.fn();
const revoked = vi.fn(async () => [{ userId: "user-1" }]);
const dbMock = {
  select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }),
  insert: () => ({ values: () => Promise.resolve() }),
  update: () => ({ set: () => ({ where: () => Object.assign(Promise.resolve(), { returning: revoked }) }) }),
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
  selectLimit.mockResolvedValue([{ userId: "user-1" }]);
  connectedElsewhere.mockResolvedValue({ otherSignIn: "o•••@example.com" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({ access_token: "at", expires_in: 3600, scope: "https://www.googleapis.com/auth/calendar" }),
          { status: 200 }
        );
      }
      if (u.startsWith("https://www.googleapis.com/oauth2/v2/userinfo")) {
        return new Response(JSON.stringify({ email: "shared@example.com" }), { status: 200 });
      }
      throw new Error(`unexpected fetch in test: ${u}`);
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const SESSION = "dtrmcp_session=sess-1";

function request(method: "GET" | "POST", path: string, cookie?: string, headers: Record<string, string> = {}) {
  return realFetch(`${base}${path}`, {
    method,
    redirect: "manual",
    headers: { ...(cookie ? { cookie } : {}), ...headers },
  });
}

/** The value a response set for one cookie, or undefined; "" when cleared. */
function setCookieValue(res: Response, name: string): string | undefined {
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const [k, ...v] = pair.split("=");
    if (k.trim() === name) return v.join("=");
  }
  return undefined;
}

describe("a duplicate account at the Google callback", () => {
  it("stores nothing and shows the warning with the masked address only", async () => {
    const res = await request("GET", "/auth/google/connect/callback?code=c&state=n1", `${SESSION}; gws_connect_nonce=n1`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("another DataToRAG account (o•••@example.com).");
    // No return path: the legacy error name the dashboard already reads.
    expect(html).toContain("/dashboard/connections?error=connected_elsewhere");
    expect(upsertServiceAccount).not.toHaveBeenCalled();
    expect(trackConnectDuplicate).toHaveBeenCalledWith(expect.anything(), "user-1", "google-workspace", "shown");
    expect(connectedElsewhere).toHaveBeenCalledWith(expect.anything(), "user-1", "google-workspace", "shared@example.com", null);
  });

  it("ignores dup_ack in the callback's query string", async () => {
    const res = await request(
      "GET",
      "/auth/google/connect/callback?code=c&state=n1&dup_ack=1",
      `${SESSION}; gws_connect_nonce=n1`
    );
    expect(await res.text()).toContain("already connected");
    expect(upsertServiceAccount).not.toHaveBeenCalled();
  });

  it("ignores an acknowledgement for a different nonce, and clears it", async () => {
    const res = await request(
      "GET",
      "/auth/google/connect/callback?code=c&state=n1",
      `${SESSION}; gws_connect_nonce=n1; dtr_dup_ack=other-nonce`
    );
    expect(await res.text()).toContain("already connected");
    expect(upsertServiceAccount).not.toHaveBeenCalled();
    expect(setCookieValue(res, "dtr_dup_ack")).toBe("");
  });

  it("connects when the acknowledgement holds this connect's own nonce, once", async () => {
    const res = await request(
      "GET",
      "/auth/google/connect/callback?code=c&state=n1",
      `${SESSION}; gws_connect_nonce=n1; dtr_dup_ack=n1`
    );
    expect(res.status).toBe(302);
    expect(upsertServiceAccount).toHaveBeenCalledTimes(1);
    expect(connectedElsewhere).not.toHaveBeenCalled();
    expect(setCookieValue(res, "dtr_dup_ack")).toBe("");
  });
});

describe("Connect it here anyway: POST /auth/connect/anyway", () => {
  it("parks the provider and restarts the connect, carrying a valid next", async () => {
    const res = await request("POST", "/auth/connect/anyway?provider=google-workspace&next=%2Fdashboard%2Fagent", SESSION);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/auth/google/connect?proceed=1&next=%2Fdashboard%2Fagent");
    expect(setCookieValue(res, "dtr_dup_ack_pending")).toBe("google-workspace");
    expect(trackConnectDuplicate).toHaveBeenCalledWith(expect.anything(), "user-1", "google-workspace", "connected_anyway");
  });

  it("the connect start turns the parked provider into an acknowledgement holding the NEW nonce", async () => {
    const res = await request("GET", "/auth/google/connect?proceed=1", `${SESSION}; dtr_dup_ack_pending=google-workspace`);
    const nonce = setCookieValue(res, "gws_connect_nonce");
    expect(nonce).toBeTruthy();
    expect(setCookieValue(res, "dtr_dup_ack")).toBe(nonce);
    expect(setCookieValue(res, "dtr_dup_ack_pending")).toBe("");
  });

  it("an ordinary connect start arms nothing and clears any stale acknowledgement", async () => {
    const res = await request("GET", "/auth/google/connect?proceed=1", `${SESSION}; dtr_dup_ack=stale`);
    expect(setCookieValue(res, "dtr_dup_ack")).toBe("");
    const atl = await request("GET", "/auth/atlassian/connect", `${SESSION}; dtr_dup_ack_pending=google-workspace`);
    expect(setCookieValue(atl, "dtr_dup_ack")).toBe("");
  });

  it("refuses without a session, from another origin, and for an unknown provider", async () => {
    selectLimit.mockResolvedValue([]);
    const anon = await request("POST", "/auth/connect/anyway?provider=google-workspace");
    expect(anon.headers.get("location")).toBe("/auth/login");
    expect(setCookieValue(anon, "dtr_dup_ack_pending")).toBeUndefined();

    selectLimit.mockResolvedValue([{ userId: "user-1" }]);
    const cross = await request("POST", "/auth/connect/anyway?provider=google-workspace", SESSION, {
      origin: "https://evil.example",
    });
    expect(cross.status).toBe(403);
    expect(setCookieValue(cross, "dtr_dup_ack_pending")).toBeUndefined();

    const unknown = await request("POST", "/auth/connect/anyway?provider=__proto__", SESSION);
    expect(unknown.status).toBe(400);
  });
});

describe("Sign in with the other account: POST /auth/connect/switch-account", () => {
  it("ends this session and starts sign-in, which shows Google's chooser", async () => {
    const res = await request("POST", "/auth/connect/switch-account?provider=google-workspace", SESSION);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/auth/google");
    expect(setCookieValue(res, "dtrmcp_session")).toBe("");
    expect(revoked).toHaveBeenCalled();
    expect(trackConnectDuplicate).toHaveBeenCalledWith(expect.anything(), "user-1", "google-workspace", "signed_in_other");
    expect(setCookieValue(res, "dtr_dup_ack_pending")).toBe("");
    expect(setCookieValue(res, "dtr_dup_ack")).toBe("");
  });

  it("sign-out clears a parked marker, so the next person at this browser meets the warning", async () => {
    const res = await request("POST", "/auth/logout", `${SESSION}; dtr_dup_ack_pending=google-workspace`);
    expect(setCookieValue(res, "dtr_dup_ack_pending")).toBe("");
  });

  it("refuses a POST from another origin", async () => {
    const res = await request("POST", "/auth/connect/switch-account", SESSION, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(revoked).not.toHaveBeenCalled();
  });
});
