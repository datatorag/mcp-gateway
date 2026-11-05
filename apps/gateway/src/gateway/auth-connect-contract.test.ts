/**
 * The connect callback's contract, one table, every provider (the pin for
 * moving the six connect flows onto one shared skeleton).
 *
 * Each provider's callback runs through the same cases over real HTTP, with
 * the provider's own endpoints stubbed: no session, a bad state, a missing
 * code, a service not offered, a link-only connect whose account is not the
 * link user's, one that is, an account held by another user with and without
 * the acknowledgement, and a success that carries a return path and the
 * stashed attribution. Where providers differ today the row says how, so a
 * difference is pinned and visible rather than smoothed over.
 *
 * The per-provider suites (`auth-connect-brevo`, `auth-connect-posthog`,
 * `auth-connect-csrf`, `auth-connect-duplicate`, `auth-connect-grant`) keep
 * their own detail: scopes, PKCE, Google's interstitial and partial grants.
 */
import { createServer, type Server } from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@datatorag-mcp/db";

const trackOAuthCompleted = vi.fn(async (..._a: unknown[]) => undefined);
const trackConnectDuplicate = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("./track", () => ({
  trackConnectLinkEvent: vi.fn(async () => undefined),
  trackLogin: vi.fn(),
  trackSignup: vi.fn(),
  trackOAuthCompleted: (...a: unknown[]) => trackOAuthCompleted(...a),
  trackConnectDuplicate: (...a: unknown[]) => trackConnectDuplicate(...a),
  trackConnectRefused: vi.fn(async () => undefined),
}));
const ATTRIBUTION = { channel: "test-attribution" };
vi.mock("./attribution", () => ({
  stashAttribution: vi.fn(),
  takeAttribution: vi.fn(() => ATTRIBUTION),
  persistAcquisition: vi.fn(async () => undefined),
}));
const upsertServiceAccount = vi.fn(async (..._a: unknown[]) => undefined);
const connectedElsewhere = vi.fn(async (..._a: unknown[]): Promise<{ otherSignIn: string } | null> => null);
vi.mock("./connected-accounts", () => ({
  upsertServiceAccount: (...a: unknown[]) => upsertServiceAccount(...a),
  connectedElsewhere: (...a: unknown[]) => connectedElsewhere(...a),
}));
const serviceOfferedTo = vi.fn(async (..._a: unknown[]) => true);
const isServiceLaunched = vi.fn(async (..._a: unknown[]) => true);
vi.mock("./service-launch", () => ({
  isServiceLaunched: (...a: unknown[]) => isServiceLaunched(...a),
  serviceOfferedTo: (...a: unknown[]) => serviceOfferedTo(...a),
}));
const liveWebSessionUserId = vi.fn(async (..._a: unknown[]): Promise<string | null> => "user-1");
const createWebSession = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("../lib/web-session", () => ({
  liveWebSessionUserId: (...a: unknown[]) => liveWebSessionUserId(...a),
  createWebSession: (...a: unknown[]) => createWebSession(...a),
}));
const spentConnectLink = vi.fn(async (..._a: unknown[]): Promise<unknown> => null);
vi.mock("./connect-links", async (orig) => ({
  ...(await orig<typeof import("./connect-links")>()),
  spentConnectLink: (...a: unknown[]) => spentConnectLink(...a),
  dropConnectLinksQuietly: vi.fn(async () => undefined),
}));

import { createAuthRouter } from "./auth";
import { postConnectDestination, CONNECT_ERROR_NOT_CONFIGURED, CONNECT_ERROR_NOT_LAUNCHED } from "./post-connect-destination";
import { GWS_SCOPE_LIST } from "./scope-grant";
import { NOTION_TOKEN_URL } from "./connectors/notion/oauth";
import { BREVO_ACCOUNT_URL, BREVO_TOKEN_URL, BREVO_USERINFO_URL } from "./connectors/brevo/oauth";
import { posthogEndpoints } from "./connectors/posthog/oauth";
import { SLACK_TOKEN_URL, SLACK_USERS_INFO_URL } from "./connectors/slack/oauth";
import { CONNECT_LINK_COPY } from "./connect-link-page";
import { DUPLICATE_COPY } from "./connect-duplicate";
import type { ConnectorId } from "./connectors/registry";

const EMAIL = "owner@example.com";
const POSTHOG = posthogEndpoints("https://us.posthog.com");

type Row = {
  provider: ConnectorId;
  callback: string;
  nonceCookie: string;
  /** Cookies the callback needs beyond the nonce (PostHog's PKCE verifier). */
  extraCookies?: Record<string, string>;
  /** The provider's endpoints, answering a successful grant for EMAIL. */
  respond: (url: string) => Response | undefined;
  /** What the callback does when the service is not offered to the user:
   * redirect with not_launched, answer 404, or not check at all. */
  notOffered: "redirect" | "404" | "not-checked";
  /** The account's external id, when the provider keys one. */
  externalAccountId: string | null;
  /** Served by the shared connect flow: its token endpoint, and the body of
   * a grant with these fields, in the provider's own shape, for the cases the
   * flow decides the same way for every connector it serves. */
  sharedFlow?: {
    tokenUrl: string;
    grant: (fields: { accessToken?: string; expiresIn?: number }) => unknown;
    /** No app credentials to configure (PostHog's client has no secret). */
    alwaysConfigured?: boolean;
    /** Its start route. */
    start: string;
  };
};

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

const ROWS: Row[] = [
  {
    provider: "google-workspace",
    callback: "/auth/google/connect/callback",
    nonceCookie: "gws_connect_nonce",
    respond: (u) =>
      u === "https://oauth2.googleapis.com/token"
        ? json({ access_token: "at", refresh_token: "rt", expires_in: 3600, scope: GWS_SCOPE_LIST.join(" ") })
        : u === "https://www.googleapis.com/oauth2/v2/userinfo"
          ? json({ email: EMAIL, verified_email: true })
          : undefined,
    notOffered: "not-checked",
    externalAccountId: null,
    sharedFlow: {
      tokenUrl: "https://oauth2.googleapis.com/token",
      start: "/auth/google/connect?proceed=1",
      grant: (f) => ({ access_token: f.accessToken, refresh_token: "rt", expires_in: f.expiresIn, scope: GWS_SCOPE_LIST.join(" ") }),
    },
  },
  {
    provider: "atlassian",
    callback: "/auth/atlassian/connect/callback",
    nonceCookie: "atl_connect_nonce",
    respond: (u) =>
      u === "https://auth.atlassian.com/oauth/token"
        ? json({ access_token: "at", refresh_token: "rt", expires_in: 3600 })
        : u === "https://api.atlassian.com/me"
          ? json({ email: EMAIL, email_verified: true })
          : undefined,
    notOffered: "not-checked",
    externalAccountId: null,
    sharedFlow: {
      tokenUrl: "https://auth.atlassian.com/oauth/token",
      start: "/auth/atlassian/connect",
      grant: (f) => ({ access_token: f.accessToken, refresh_token: "rt", expires_in: f.expiresIn }),
    },
  },
  {
    provider: "notion",
    callback: "/auth/notion/connect/callback",
    nonceCookie: "notion_connect_nonce",
    respond: (u) =>
      u === NOTION_TOKEN_URL
        ? json({ access_token: "at", refresh_token: "rt", owner: { user: { person: { email: EMAIL } } }, workspace_id: "ws-1", workspace_name: "Workspace" })
        : undefined,
    // The launch gate, at the start and again at the callback.
    notOffered: "redirect",
    externalAccountId: "ws-1",
    sharedFlow: {
      tokenUrl: NOTION_TOKEN_URL,
      start: "/auth/notion/connect",
      grant: (f) => ({
        access_token: f.accessToken,
        refresh_token: "rt",
        expires_in: f.expiresIn,
        owner: { user: { person: { email: EMAIL } } },
        workspace_id: "ws-1",
      }),
    },
  },
  {
    provider: "brevo",
    callback: "/auth/brevo/connect/callback",
    nonceCookie: "brevo_connect_nonce",
    respond: (u) =>
      u === BREVO_TOKEN_URL
        ? json({ access_token: "at", refresh_token: "rt", expires_in: 3600 })
        : u === BREVO_USERINFO_URL
          ? json({ email: EMAIL, email_verified: true })
          : u === BREVO_ACCOUNT_URL
            ? json({ companyName: "Company" })
            : undefined,
    notOffered: "redirect",
    externalAccountId: null,
    sharedFlow: {
      tokenUrl: BREVO_TOKEN_URL,
      start: "/auth/brevo/connect",
      grant: (f) => ({ access_token: f.accessToken, refresh_token: "rt", expires_in: f.expiresIn }),
    },
  },
  {
    provider: "posthog",
    callback: "/auth/posthog/connect/callback",
    nonceCookie: "posthog_connect_nonce",
    extraCookies: { posthog_connect_pkce: "verifier-1" },
    respond: (u) =>
      u === POSTHOG.token
        ? json({ access_token: "at", refresh_token: "rt", expires_in: 3600, scoped_teams: [42] })
        : u === POSTHOG.userinfo
          ? json({ email: EMAIL, email_verified: true })
          : u === POSTHOG.project(42)
            ? json({ name: "Project" })
            : undefined,
    notOffered: "redirect",
    externalAccountId: "42",
    sharedFlow: {
      tokenUrl: POSTHOG.token,
      start: "/auth/posthog/connect",
      alwaysConfigured: true,
      grant: (f) => ({ access_token: f.accessToken, refresh_token: "rt", expires_in: f.expiresIn, scoped_teams: [42] }),
    },
  },
  {
    provider: "slack",
    callback: "/auth/slack/connect/callback",
    nonceCookie: "slack_connect_nonce",
    respond: (u) =>
      u === SLACK_TOKEN_URL
        ? json({ ok: true, team: { id: "T1", name: "Company" }, authed_user: { id: "U1", access_token: "at", scope: "search:read" } })
        : u.startsWith(SLACK_USERS_INFO_URL)
          ? json({ ok: true, user: { profile: { email: EMAIL } } })
          : undefined,
    // Admin-only: a refusal looks like a path that does not exist.
    notOffered: "404",
    externalAccountId: "T1",
    sharedFlow: {
      tokenUrl: SLACK_TOKEN_URL,
      start: "/auth/slack/connect",
      grant: (f) => ({
        ok: true,
        team: { id: "T1", name: "Company" },
        authed_user: { id: "U1", access_token: f.accessToken, expires_in: f.expiresIn, scope: "search:read" },
      }),
    },
  },
];

const signInEmail = vi.fn(async (..._a: unknown[]): Promise<Array<{ email: string }>> => [{ email: EMAIL }]);
const dbMock = {
  select: () => ({ from: () => ({ where: () => ({ limit: signInEmail }) }) }),
} as unknown as Database;
const onConnected = vi.fn();

let server: Server;
let base: string;
/** The same router with no connector's app credentials set. */
let unconfiguredServer: Server;
let unconfiguredBase: string;
const realFetch = globalThis.fetch;
const outbound = vi.fn();
let row: Row;

beforeAll(async () => {
  const app = express();
  app.use(cookieParser());
  app.use(
    createAuthRouter(dbMock, {
      googleClientId: "cid",
      googleClientSecret: "s",
      gwsClientId: "gws-cid",
      gwsClientSecret: "s",
      atlassianClientId: "atl-cid",
      atlassianClientSecret: "s",
      notionClientId: "notion-cid",
      notionClientSecret: "s",
      brevoClientId: "brevo-cid",
      brevoClientSecret: "s",
      slackClientId: "slack-cid",
      slackClientSecret: "s",
      slackTeamId: "T1",
      baseUrl: "http://127.0.0.1",
      onConnected,
    })
  );
  server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (typeof addr === "string" || addr === null) throw new Error("no port");
  base = `http://127.0.0.1:${addr.port}`;

  const bare = express();
  bare.use(cookieParser());
  bare.use(
    createAuthRouter(dbMock, {
      googleClientId: "",
      googleClientSecret: "",
      gwsClientId: "",
      gwsClientSecret: "",
      atlassianClientId: "",
      atlassianClientSecret: "",
      notionClientId: "",
      notionClientSecret: "",
      baseUrl: "http://127.0.0.1",
    })
  );
  unconfiguredServer = createServer(bare);
  await new Promise<void>((r) => unconfiguredServer.listen(0, "127.0.0.1", r));
  const bareAddr = unconfiguredServer.address();
  if (typeof bareAddr === "string" || bareAddr === null) throw new Error("no port");
  unconfiguredBase = `http://127.0.0.1:${bareAddr.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await new Promise<void>((r) => unconfiguredServer.close(() => r()));
});

beforeEach(() => {
  vi.clearAllMocks();
  liveWebSessionUserId.mockResolvedValue("user-1");
  spentConnectLink.mockResolvedValue(null);
  serviceOfferedTo.mockResolvedValue(true);
  isServiceLaunched.mockResolvedValue(true);
  connectedElsewhere.mockResolvedValue(null);
  signInEmail.mockResolvedValue([{ email: EMAIL }]);
  vi.stubGlobal(
    "fetch",
    outbound.mockImplementation(async (url: string | URL) => {
      const answer = row.respond(String(url));
      if (!answer) throw new Error(`unexpected fetch in test: ${String(url)}`);
      return answer;
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The callback, with the nonce cookie `nonce` and `?state=` `state`. */
function callback(opts: { state?: string; code?: string | null; session?: boolean; link?: boolean; cookies?: Record<string, string> } = {}) {
  const cookies: Record<string, string> = { [row.nonceCookie]: "nonce-1", ...row.extraCookies, ...opts.cookies };
  if (opts.session !== false) cookies.dtrmcp_session = "session-1";
  if (opts.link) cookies.dtr_connect_link = "link-1";
  const query = new URLSearchParams({ state: opts.state ?? "nonce-1" });
  if (opts.code !== null) query.set("code", opts.code ?? "code-1");
  return realFetch(`${base}${row.callback}?${query}`, {
    redirect: "manual",
    headers: { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") },
  });
}

const location = (res: Response) => res.headers.get("location");

describe.each(ROWS)("the $provider connect callback", (r) => {
  beforeEach(() => {
    row = r;
  });

  it("sends a browser with neither a session nor a link to sign in, and asks the provider nothing", async () => {
    const res = await callback({ session: false });
    expect(res.status).toBe(302);
    expect(location(res)).toBe("/auth/login");
    expect(outbound).not.toHaveBeenCalled();
  });

  it("refuses a state that is not its nonce before the code is looked at", async () => {
    const res = await callback({ state: "other" });
    expect(location(res)).toBe(postConnectDestination({ error: "invalid_state" }));
    expect(outbound).not.toHaveBeenCalled();
    expect(upsertServiceAccount).not.toHaveBeenCalled();
  });

  it("refuses a callback without a code", async () => {
    const res = await callback({ code: null });
    expect(location(res)).toBe(postConnectDestination({ error: "missing_code" }));
    expect(outbound).not.toHaveBeenCalled();
  });

  it("handles a service no longer offered to the user as its row says", async () => {
    serviceOfferedTo.mockResolvedValue(false);
    isServiceLaunched.mockResolvedValue(false);
    const res = await callback();
    if (r.notOffered === "redirect") {
      expect(location(res)).toBe(postConnectDestination({ error: CONNECT_ERROR_NOT_LAUNCHED }));
      expect(outbound).not.toHaveBeenCalled();
    } else if (r.notOffered === "404") {
      expect(res.status).toBe(404);
      expect(outbound).not.toHaveBeenCalled();
    } else {
      expect(location(res)).toBe(postConnectDestination({ provider: r.provider }));
      expect(upsertServiceAccount).toHaveBeenCalledTimes(1);
    }
  });

  describe("a connect only a link vouches for", () => {
    beforeEach(() => {
      liveWebSessionUserId.mockResolvedValue(null);
      spentConnectLink.mockResolvedValue({ id: "link-row", userId: "user-1", provider: r.provider, path: "tool_result", clientName: "Claude" });
    });

    it("stores nothing and asks for a sign-in when the account is not the link user's", async () => {
      signInEmail.mockResolvedValue([{ email: "someone-else@example.com" }]);
      const res = await callback({ session: false, link: true });
      expect(res.status).toBe(200);
      expect(await res.text()).toContain(CONNECT_LINK_COPY.confirmBody);
      expect(upsertServiceAccount).not.toHaveBeenCalled();
      expect(createWebSession).not.toHaveBeenCalled();
    });

    it("signs the link user in and stores the account when it is theirs, and says which link it came from", async () => {
      const res = await callback({ session: false, link: true });
      expect(location(res)).toBe(postConnectDestination({ provider: r.provider }));
      expect(createWebSession).toHaveBeenCalledTimes(1);
      expect(upsertServiceAccount).toHaveBeenCalledTimes(1);
      expect(onConnected).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", provider: r.provider, link: expect.objectContaining({ id: "link-row" }) }));
    });
  });

  describe("an account another DataToRAG user holds", () => {
    beforeEach(() => {
      connectedElsewhere.mockResolvedValue({ otherSignIn: "o•••@example.com" });
    });

    it("shows the warning and stores nothing", async () => {
      const res = await callback();
      expect(res.status).toBe(200);
      expect(await res.text()).toContain(DUPLICATE_COPY.connectAnyway);
      expect(upsertServiceAccount).not.toHaveBeenCalled();
      expect(trackConnectDuplicate).toHaveBeenCalledWith(dbMock, "user-1", r.provider, "shown");
      expect(connectedElsewhere).toHaveBeenCalledWith(dbMock, "user-1", r.provider, EMAIL, r.externalAccountId);
    });

    it("connects anyway when this connect's own nonce was acknowledged", async () => {
      const res = await callback({ cookies: { dtr_dup_ack: "nonce-1" } });
      expect(location(res)).toBe(postConnectDestination({ provider: r.provider }));
      expect(upsertServiceAccount).toHaveBeenCalledTimes(1);
    });
  });

  it("stores the account, records the completion with its attribution, and returns to the parked path", async () => {
    const next = "/dashboard/agent?thread=t1";
    const res = await callback({ cookies: { dtr_connect_next: encodeURIComponent(next) } });
    expect(location(res)).toBe(postConnectDestination({ requestedPath: next, provider: r.provider }));
    expect(upsertServiceAccount).toHaveBeenCalledTimes(1);
    const [, userId, provider, email, , , , identity] = upsertServiceAccount.mock.calls[0];
    expect({ userId, provider, email }).toEqual({ userId: "user-1", provider: r.provider, email: EMAIL });
    // A provider that names no account leaves the name the user gave it:
    // no label is passed, so a reconnect never clears one.
    if (r.provider === "google-workspace" || r.provider === "atlassian") {
      expect(Object.keys((identity as object | undefined) ?? {})).not.toContain("label");
    }
    expect(trackOAuthCompleted).toHaveBeenCalledWith(
      dbMock,
      "user-1",
      r.provider,
      EMAIL,
      ATTRIBUTION,
      // Only Google reports how much of its consent came back.
      r.provider === "google-workspace" ? expect.objectContaining({ complete: true }) : undefined,
      expect.objectContaining({ entry: "agent" })
    );
    expect(onConnected).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", provider: r.provider, link: null }));
    // Every one-shot cookie is cleared on the way out.
    const cleared = res.headers.getSetCookie().filter((c) => /Expires=Thu, 01 Jan 1970/.test(c)).map((c) => c.split("=")[0]);
    expect(cleared).toEqual(expect.arrayContaining([row.nonceCookie, "dtr_connect_next", "dtr_dup_ack", "dtr_connect_link"]));
  });
});

/** The cases the shared connect flow decides the same way for every
 * connector it serves (the rows with `sharedFlow`). */
describe.each(ROWS.filter((r) => r.sharedFlow))("the $provider connect callback, on the shared flow", (r) => {
  beforeEach(() => {
    row = r;
  });

  /** The token endpoint answers `answer` (or fails with it); the rest as the row says. */
  function tokenAnswer(answer: Response | Error) {
    outbound.mockImplementation(async (url: string | URL) => {
      if (String(url) === r.sharedFlow!.tokenUrl) {
        if (answer instanceof Error) throw answer;
        return answer;
      }
      const ok = row.respond(String(url));
      if (!ok) throw new Error(`unexpected fetch in test: ${String(url)}`);
      return ok;
    });
  }

  it("treats a token call that fails outright as a refused exchange, and stores nothing", async () => {
    tokenAnswer(new TypeError("fetch failed"));
    const res = await callback();
    expect(location(res)).toBe(postConnectDestination({ error: "token_exchange_failed" }));
    expect(upsertServiceAccount).not.toHaveBeenCalled();
  });

  it("refuses an answer without an access token", async () => {
    tokenAnswer(json(r.sharedFlow!.grant({})));
    const res = await callback();
    expect(location(res)).toBe(postConnectDestination({ error: "token_exchange_failed" }));
    expect(upsertServiceAccount).not.toHaveBeenCalled();
  });

  it("stores no expiry unless the answer gives a positive number of seconds", async () => {
    tokenAnswer(json(r.sharedFlow!.grant({ accessToken: "at", expiresIn: 0 })));
    await callback();
    expect(upsertServiceAccount.mock.calls[0][6]).toBeNull();
  });
});

/** A connector with app credentials, none of them set. */
describe.each(ROWS.filter((r) => r.sharedFlow && !r.sharedFlow.alwaysConfigured))(
  "the $provider connect start, unconfigured",
  (r) => {
    beforeEach(() => {
      row = r;
    });

    it("refuses an unconfigured app at the start, before any cookie or call", async () => {
      const res = await realFetch(`${unconfiguredBase}${r.sharedFlow!.start}`, {
        redirect: "manual",
        headers: { cookie: "dtrmcp_session=session-1" },
      });
      expect(location(res)).toBe(postConnectDestination({ error: CONNECT_ERROR_NOT_CONFIGURED }));
      expect(res.headers.getSetCookie().some((c) => c.startsWith(`${r.nonceCookie}=`))).toBe(false);
      expect(outbound).not.toHaveBeenCalled();
    });
  }
);
