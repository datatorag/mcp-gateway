/**
 * SCRUM-466: the connect link's page and its POST, through the real router
 * over real HTTP. What must hold: a GET spends nothing; a browser signed in
 * as someone else is refused before anything is spent; the POST spends once
 * and hands over to the provider's own connect start with a one-shot cookie;
 * the page names the link's account only masked.
 */
import { createServer, type Server } from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@datatorag-mcp/db";

const peekConnectLink = vi.fn();
const claimConnectLink = vi.fn();
vi.mock("./connect-links", async (orig) => ({
  ...(await orig<typeof import("./connect-links")>()),
  peekConnectLink: (...a: unknown[]) => peekConnectLink(...a),
  claimConnectLink: (...a: unknown[]) => claimConnectLink(...a),
}));
const liveWebSessionUserId = vi.fn();
vi.mock("../lib/web-session", () => ({
  liveWebSessionUserId: (...a: unknown[]) => liveWebSessionUserId(...a),
}));

import { createConnectLinkRouter } from "./connect-link-route";
import { CONNECT_LINK_COPY } from "./connect-link-page";

const TOKEN = "A".repeat(43);
const ownerEmail = vi.fn(async () => [{ email: "jane.doe@example.com" }]);
const dbMock = {
  select: () => ({ from: () => ({ where: () => ({ limit: ownerEmail }) }) }),
} as unknown as Database;

let server: Server;
let base: string;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const app = express();
  app.use(cookieParser());
  app.use(createConnectLinkRouter(dbMock, { baseUrl: "http://127.0.0.1" }));
  // What sits behind the router in production: the static files and the app.
  app.use((_req, res) => res.status(299).send("fell through"));
  server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (typeof addr === "string" || addr === null) throw new Error("no port");
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

function link(provider = "google-workspace", userId = "user-1") {
  return { id: "0b6c1f0e-6a1d-4c35-9a77-2f9a7f1f9a10", userId, provider, path: "tool_result", clientName: "Claude", expiresAt: new Date(Date.now() + 60_000) };
}

beforeEach(() => {
  vi.clearAllMocks();
  peekConnectLink.mockResolvedValue(link());
  claimConnectLink.mockResolvedValue(link());
  liveWebSessionUserId.mockResolvedValue(null);
});

function request(method: "GET" | "POST", path: string, headers: Record<string, string> = {}) {
  return realFetch(`${base}${path}`, { method, redirect: "manual", headers });
}

describe("GET /connect/<token>", () => {
  it("shows Google's consent page posting to the link, names the account masked, and spends nothing", async () => {
    const res = await request("GET", `/connect/${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain(`<form method="post" action="/connect/${TOKEN}">`);
    expect(html).toContain("j•••@example.com");
    expect(html).not.toContain("jane.doe@example.com");
    expect(claimConnectLink).not.toHaveBeenCalled();
  });

  it("shows Atlassian's and Notion's own page with one button", async () => {
    for (const [provider, button] of [["atlassian", "Continue to Atlassian"], ["notion", "Continue to Notion"]]) {
      peekConnectLink.mockResolvedValue(link(provider));
      const html = await (await request("GET", `/connect/${TOKEN}`)).text();
      expect(html).toContain(button);
      expect(html).toContain(`action="/connect/${TOKEN}"`);
      expect(html).toContain("j•••@example.com");
    }
    expect(claimConnectLink).not.toHaveBeenCalled();
  });

  it("refuses a browser signed in as someone else, and spends nothing", async () => {
    liveWebSessionUserId.mockResolvedValue("user-2");
    const res = await request("GET", `/connect/${TOKEN}`, { cookie: "dtrmcp_session=s" });
    expect(res.status).toBe(403);
    const html = await res.text();
    expect(html).toContain(CONNECT_LINK_COPY.otherAccountTitle);
    expect(html).not.toContain("example.com");
    expect(claimConnectLink).not.toHaveBeenCalled();
  });

  it("goes straight on for the link's own user", async () => {
    liveWebSessionUserId.mockResolvedValue("user-1");
    expect((await request("GET", `/connect/${TOKEN}`, { cookie: "dtrmcp_session=s" })).status).toBe(200);
  });

  it("an expired, spent or unknown link is one page", async () => {
    peekConnectLink.mockResolvedValue(null);
    const res = await request("GET", `/connect/${TOKEN}`);
    expect(res.status).toBe(410);
    expect(await res.text()).toContain(CONNECT_LINK_COPY.expiredBody);
  });

  it("leaves the consent captures under /connect to the static files", async () => {
    const res = await request("GET", "/connect/consent-1-wants-access.webp");
    expect(res.status).toBe(299);
    expect(peekConnectLink).not.toHaveBeenCalled();
  });
});

describe("POST /connect/<token>", () => {
  it("spends the link once, leaves its id in a one-shot cookie, and hands over to the connect start", async () => {
    const res = await request("POST", `/connect/${TOKEN}`);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/auth/google/connect?proceed=1&next=%2Fconnect%2Fdone");
    expect(claimConnectLink).toHaveBeenCalledTimes(1);
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith("dtr_connect_link="));
    expect(cookie).toContain(`dtr_connect_link=${link().id}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Max-Age=600/);
  });

  it("hands Atlassian and Notion to their own starts", async () => {
    claimConnectLink.mockResolvedValue(link("notion"));
    const res = await request("POST", `/connect/${TOKEN}`);
    expect(res.headers.get("location")).toBe("/auth/notion/connect?next=%2Fconnect%2Fdone");
  });

  it("refuses a cross-site POST before looking at the link", async () => {
    const res = await request("POST", `/connect/${TOKEN}`, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(peekConnectLink).not.toHaveBeenCalled();
    expect(claimConnectLink).not.toHaveBeenCalled();
  });

  it("refuses a browser signed in as someone else, leaving the link unspent", async () => {
    liveWebSessionUserId.mockResolvedValue("user-2");
    const res = await request("POST", `/connect/${TOKEN}`, { cookie: "dtrmcp_session=s" });
    expect(res.status).toBe(403);
    expect(claimConnectLink).not.toHaveBeenCalled();
  });

  it("a second use shows the expired page", async () => {
    claimConnectLink.mockResolvedValue(null);
    const res = await request("POST", `/connect/${TOKEN}`);
    expect(res.status).toBe(410);
    expect(res.headers.getSetCookie().some((c) => c.startsWith("dtr_connect_link="))).toBe(false);
  });
});

describe("GET /connect/done", () => {
  it("says the service is connected", async () => {
    const html = await (await request("GET", "/connect/done?connected=notion")).text();
    expect(html).toContain("Notion is connected");
  });

  it("names what a partial grant left out", async () => {
    const html = await (
      await request("GET", "/connect/done?connected=google-workspace&partial=google-workspace&missing=Gmail%2CDrive")
    ).text();
    expect(html).toContain("Google Workspace is connected, with some access missing");
    expect(html).toContain("Not allowed on the consent screen: Gmail, Drive.");
  });

  it("says it did not connect on an error or an unknown service", async () => {
    for (const q of ["connected=notion&connect_error=token_exchange_failed", "connect_error=invalid_state", "connected=%3Cscript%3E"]) {
      const html = await (await request("GET", `/connect/done?${q}`)).text();
      expect(html).toContain(CONNECT_LINK_COPY.failedTitle);
      expect(html).not.toContain("<script>");
    }
  });
});

describe("GET /connect/resume/<provider>", () => {
  it("sends a browser with no session to sign in, and back here after", async () => {
    const res = await request("GET", "/connect/resume/atlassian");
    expect(res.headers.get("location")).toBe("/auth/google?next=%2Fconnect%2Fresume%2Fatlassian");
  });

  it("restarts the connect for a signed-in browser", async () => {
    liveWebSessionUserId.mockResolvedValue("user-1");
    const res = await request("GET", "/connect/resume/google-workspace", { cookie: "dtrmcp_session=s" });
    expect(res.headers.get("location")).toBe("/auth/google/connect?proceed=1&next=%2Fconnect%2Fdone");
  });

  it("knows only the three providers", async () => {
    expect((await request("GET", "/connect/resume/evil")).status).toBe(404);
  });
});

describe("the pages' words", () => {
  it("carry no em-dash or en-dash", () => {
    const all = Object.values(CONNECT_LINK_COPY)
      .map((v) => (typeof v === "function" ? (v as (x: string) => string)("X") : v))
      .join("\n");
    expect(all).not.toMatch(/[–—]/);
  });
});
