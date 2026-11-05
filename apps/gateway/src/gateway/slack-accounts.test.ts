/**
 * SCRUM-454: the Slack connect pair, for the company workspace only.
 *
 * Driven through the REAL router over real HTTP with a fake fetch, built
 * against Slack's documented OAuth v2 behaviour (user scopes only, token
 * rotation on): the exchange answers HTTP 200 with `ok`, the person's token
 * is under `authed_user`, and the email comes from `users.info`. What must
 * hold: only an admin can start it; it asks for user scopes and no bot
 * scopes; the callback stores nothing for another workspace, an Enterprise
 * Grid install or a grant with no email; and a good grant is stored with the
 * team as the account's external id. Values are placeholders.
 */

import { createServer, type Server } from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@datatorag-mcp/db";

vi.mock("./track", () => ({
  trackConnectLinkEvent: vi.fn(async () => undefined),
  trackConnectDuplicate: vi.fn(async () => undefined),
  trackLogin: vi.fn(),
  trackSignup: vi.fn(),
  trackOAuthCompleted: vi.fn(async () => undefined),
}));
vi.mock("./attribution", () => ({
  stashAttribution: vi.fn(),
  takeAttribution: vi.fn(() => null),
  persistAcquisition: vi.fn(async () => undefined),
}));
vi.mock("./lifecycle", () => ({ sendWelcomeEmail: vi.fn(async () => undefined) }));
vi.mock("./signup-alert", () => ({ notifySignup: vi.fn(async () => undefined) }));
const upsertServiceAccount = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("./connected-accounts", () => ({
  upsertServiceAccount: (...args: unknown[]) => upsertServiceAccount(...args),
  connectedElsewhere: async () => null,
}));
// The audience rule itself is pinned in service-launch.audience.test.ts;
// here the route must ask it, for this user, and obey.
const serviceOfferedTo = vi.fn(async (..._args: unknown[]) => true);
vi.mock("./service-launch", () => ({
  isServiceLaunched: vi.fn(async () => true),
  serviceOfferedTo: (...args: unknown[]) => serviceOfferedTo(...args),
}));

import { createAuthRouter } from "./auth";
import { SLACK_USER_SCOPES } from "./connectors/slack/oauth";

const selectLimit = vi.fn();
const dbMock = {
  select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }),
  insert: () => ({ values: () => Promise.resolve() }),
  update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
} as unknown as Database;

const TEAM = "team-1";
const SLACK_CONFIG = {
  slackClientId: "slack-cid",
  slackClientSecret: "slack-secret",
  slackTeamId: TEAM,
};

const realFetch = globalThis.fetch;
const outbound = vi.fn();

async function startServer(slack: { slackClientId: string; slackClientSecret: string; slackTeamId: string }) {
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
      ...slack,
      baseUrl: "http://127.0.0.1",
    })
  );
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (typeof addr === "string" || addr === null) throw new Error("no port");
  return { server, base: `http://127.0.0.1:${addr.port}` };
}

let server: Server;
let base: string;
let unconfigured: { server: Server; base: string };

beforeAll(async () => {
  ({ server, base } = await startServer(SLACK_CONFIG));
  unconfigured = await startServer({ slackClientId: "", slackClientSecret: "", slackTeamId: "" });
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await new Promise<void>((r) => unconfigured.server.close(() => r()));
});

/** oauth.v2.access for a user-scope-only app with rotation on, as Slack
 * documents it. Reassigned per test where a field must differ. */
const GRANT = {
  ok: true,
  app_id: "app-1",
  authed_user: {
    id: "slack-user-1",
    scope: SLACK_USER_SCOPES,
    access_token: "user-token-1",
    token_type: "user",
    refresh_token: "refresh-token-1",
    expires_in: 43200,
  },
  team: { id: TEAM, name: "Example Co" },
  enterprise: null,
  is_enterprise_install: false,
};
let grantBody: Record<string, unknown> = GRANT;
let usersInfoBody: Record<string, unknown> = {
  ok: true,
  user: { id: "slack-user-1", profile: { email: "person@example.test" } },
};

beforeEach(() => {
  vi.clearAllMocks();
  serviceOfferedTo.mockResolvedValue(true);
  grantBody = GRANT;
  usersInfoBody = { ok: true, user: { id: "slack-user-1", profile: { email: "person@example.test" } } };
  selectLimit.mockResolvedValue([{ userId: "user-1" }]);
  vi.stubGlobal(
    "fetch",
    outbound.mockImplementation(async (url: string | URL) => {
      const u = String(url);
      if (u.startsWith("https://slack.com/api/oauth.v2.access")) {
        return new Response(JSON.stringify(grantBody), { status: 200 });
      }
      if (u.startsWith("https://slack.com/api/users.info")) {
        return new Response(JSON.stringify(usersInfoBody), { status: 200 });
      }
      throw new Error(`unexpected fetch in test: ${u}`);
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function rawGet(path: string, cookie?: string, at = base) {
  return realFetch(`${at}${path}`, { redirect: "manual", headers: cookie ? { cookie } : undefined });
}

const SESSION = "dtrmcp_session=sess-1";
const CALLBACK = "/auth/slack/connect/callback?code=real-code&state=n1";
const WITH_NONCE = `${SESSION}; slack_connect_nonce=n1`;

const calls = (prefix: string) => outbound.mock.calls.filter((c) => String(c[0]).startsWith(prefix));

describe("GET /auth/slack/connect", () => {
  it("needs a session", async () => {
    const res = await rawGet("/auth/slack/connect");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/auth/login");
  });

  it("connect route 404s for a non-admin", async () => {
    serviceOfferedTo.mockResolvedValue(false);
    const res = await rawGet("/auth/slack/connect", SESSION);
    expect(res.status).toBe(404);
    expect(serviceOfferedTo).toHaveBeenCalledWith(dbMock, "slack", "user-1");
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("set-cookie") ?? "").not.toContain("slack_connect_nonce=");
    expect(outbound).not.toHaveBeenCalled();
  });

  it("connect redirects with user_scope and no scope param", async () => {
    const res = await rawGet("/auth/slack/connect", SESSION);
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "");
    expect(`${location.origin}${location.pathname}`).toBe("https://slack.com/oauth/v2/authorize");
    expect(location.searchParams.get("client_id")).toBe("slack-cid");
    expect(location.searchParams.get("user_scope")).toBe(SLACK_USER_SCOPES);
    expect(location.searchParams.has("scope")).toBe(false);
    expect(location.searchParams.get("redirect_uri")).toBe("http://127.0.0.1/auth/slack/connect/callback");
    // Pins the authorize page to the company workspace.
    expect(location.searchParams.get("team")).toBe(TEAM);
    const state = location.searchParams.get("state");
    expect(state).toBeTruthy();
    expect(state).not.toBe("sess-1");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`slack_connect_nonce=${state}`);
    expect(setCookie).toContain("HttpOnly");
  });

  it("the requested scopes are exactly the user scopes in the plan", () => {
    expect(SLACK_USER_SCOPES).toBe(
      "channels:read,groups:read,im:read,mpim:read,channels:history,groups:history,im:history,mpim:history,search:read,chat:write,reactions:write,im:write,users:read,users:read.email,files:read"
    );
  });

  it("missing config answers not configured and offers nothing", async () => {
    const res = await rawGet("/auth/slack/connect", SESSION, unconfigured.base);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/dashboard/connections?error=service_not_configured");
    expect(res.headers.get("set-cookie") ?? "").not.toContain("slack_connect_nonce=");
    expect(outbound).not.toHaveBeenCalled();
  });
});

describe("GET /auth/slack/connect/callback", () => {
  it("rejects a mismatched or missing nonce, and never reaches the exchange", async () => {
    for (const cookie of [`${SESSION}; slack_connect_nonce=n2`, SESSION]) {
      const res = await rawGet(CALLBACK, cookie);
      expect(res.headers.get("location")).toBe("/dashboard/connections?error=invalid_state");
    }
    expect(outbound).not.toHaveBeenCalled();
    expect(upsertServiceAccount).not.toHaveBeenCalled();
  });

  it("refuses for a user the audience gate leaves out, before any exchange", async () => {
    serviceOfferedTo.mockResolvedValue(false);
    const res = await rawGet(CALLBACK, WITH_NONCE);
    expect(res.status).toBe(404);
    expect(serviceOfferedTo).toHaveBeenCalledWith(dbMock, "slack", "user-1");
    expect(outbound).not.toHaveBeenCalled();
    expect(upsertServiceAccount).not.toHaveBeenCalled();
  });

  it("refuses an ok:false exchange, storing nothing", async () => {
    grantBody = { ok: false, error: "invalid_code" };
    const res = await rawGet(CALLBACK, WITH_NONCE);
    expect(res.headers.get("location")).toBe("/dashboard/connections?error=token_exchange_failed");
    expect(calls("https://slack.com/api/users.info")).toHaveLength(0);
    expect(upsertServiceAccount).not.toHaveBeenCalled();
  });

  it("callback refuses a team that is not SLACK_CONNECTOR_TEAM_ID and stores nothing", async () => {
    grantBody = { ...GRANT, team: { id: "team-other", name: "Elsewhere" } };
    const res = await rawGet(CALLBACK, WITH_NONCE);
    expect(res.headers.get("location")).toBe("/dashboard/connections?error=workspace_not_allowed");
    // The foreign token is never used for anything.
    expect(calls("https://slack.com/api/users.info")).toHaveLength(0);
    expect(upsertServiceAccount).not.toHaveBeenCalled();
  });

  it("callback refuses an enterprise install", async () => {
    grantBody = { ...GRANT, is_enterprise_install: true };
    const res = await rawGet(CALLBACK, WITH_NONCE);
    expect(res.headers.get("location")).toBe("/dashboard/connections?error=enterprise_install_not_supported");
    expect(calls("https://slack.com/api/users.info")).toHaveLength(0);
    expect(upsertServiceAccount).not.toHaveBeenCalled();
  });

  it("callback refuses a grant with no email and stores nothing", async () => {
    usersInfoBody = { ok: true, user: { id: "slack-user-1", profile: {} } };
    const res = await rawGet(CALLBACK, WITH_NONCE);
    expect(res.headers.get("location")).toBe("/dashboard/connections?error=could_not_resolve_account_email");
    expect(upsertServiceAccount).not.toHaveBeenCalled();
  });

  it("refuses a grant with no user token, storing nothing", async () => {
    grantBody = { ...GRANT, authed_user: { id: "slack-user-1", scope: "" } };
    const res = await rawGet(CALLBACK, WITH_NONCE);
    expect(res.headers.get("location")).toBe("/dashboard/connections?error=token_exchange_failed");
    expect(upsertServiceAccount).not.toHaveBeenCalled();
  });

  it("callback stores sealed tokens with external_account_id = team id and label = team name", async () => {
    const before = Date.now();
    const res = await rawGet(CALLBACK, WITH_NONCE);
    expect(res.headers.get("location")).toBe("/dashboard/agent?connected=slack&landing=connect");

    // The exchange: form-encoded, credentials in the body, never in a header.
    const exchange = calls("https://slack.com/api/oauth.v2.access");
    expect(exchange).toHaveLength(1);
    const init = exchange[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("content-type")).toContain("application/x-www-form-urlencoded");
    const form = new URLSearchParams(String(init.body));
    expect(Object.fromEntries(form)).toEqual({
      client_id: "slack-cid",
      client_secret: "slack-secret",
      code: "real-code",
      redirect_uri: "http://127.0.0.1/auth/slack/connect/callback",
    });

    // The email: users.info for the authed user, with the NEW user token.
    const info = calls("https://slack.com/api/users.info");
    expect(info).toHaveLength(1);
    expect(new URL(String(info[0][0])).searchParams.get("user")).toBe("slack-user-1");
    expect(new Headers((info[0][1] as RequestInit).headers).get("authorization")).toBe("Bearer user-token-1");

    // Stored through upsertServiceAccount, which seals the pair (SCRUM-442).
    expect(upsertServiceAccount).toHaveBeenCalledTimes(1);
    const args = upsertServiceAccount.mock.calls[0];
    expect(args[1]).toBe("user-1");
    expect(args[2]).toBe("slack");
    expect(args[3]).toBe("person@example.test");
    expect(args[4]).toEqual(
      expect.objectContaining({
        access_token: "user-token-1",
        refresh_token: "refresh-token-1",
        // Stored space-separated, the form every stored grant uses.
        scope: SLACK_USER_SCOPES.split(",").join(" "),
      })
    );
    const expiresAt = args[6] as Date;
    expect(expiresAt).toBeInstanceOf(Date);
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 43200 * 1000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 43200 * 1000);
    expect(args[7]).toEqual({ externalAccountId: TEAM, label: "Example Co" });

    expect(res.headers.get("set-cookie") ?? "").toContain("slack_connect_nonce=;");
  });

  it("clears the nonce on a failure path too", async () => {
    const res = await rawGet("/auth/slack/connect/callback?code=c&state=n2", WITH_NONCE);
    expect(res.headers.get("set-cookie") ?? "").toContain("slack_connect_nonce=;");
  });

  it("missing config stores nothing and contacts nobody", async () => {
    const res = await rawGet(CALLBACK, WITH_NONCE, unconfigured.base);
    expect(res.headers.get("location")).toBe("/dashboard/connections?error=service_not_configured");
    expect(outbound).not.toHaveBeenCalled();
    expect(upsertServiceAccount).not.toHaveBeenCalled();
  });
});
