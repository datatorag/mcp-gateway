/**
 * SCRUM-472: the connect link's button, pressed in a real Chrome. Under the
 * Fetch standard a form POST from a page whose referrer policy is
 * `no-referrer` carries `Origin: null`, same-origin or not, and the POST's
 * same-origin check refuses that. An HTTP client sends whatever Origin it is
 * told to, so only a browser shows which one the page really produces; this
 * suite is the check the route's own tests cannot be.
 *
 * Skips where no Chrome is installed (see test-utils/headless-chrome.ts).
 */
import { createServer, type Server } from "node:http";
import express, { type Router } from "express";
import cookieParser from "cookie-parser";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@datatorag-mcp/db";
import { findChrome, launchChrome, waitForEvent, type Chrome } from "../test-utils/headless-chrome";

const peekConnectLink = vi.fn();
const claimConnectLink = vi.fn();
vi.mock("./connect-links", async (orig) => ({
  ...(await orig<typeof import("./connect-links")>()),
  peekConnectLink: (...a: unknown[]) => peekConnectLink(...a),
  claimConnectLink: (...a: unknown[]) => claimConnectLink(...a),
}));
vi.mock("../lib/web-session", () => ({
  liveWebSessionUserId: async () => null,
}));

import { createConnectLinkRouter } from "./connect-link-route";

const chromePath = findChrome();
const TOKEN = "A".repeat(43);
const dbMock = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ email: "jane.doe@example.com" }] }) }) }),
} as unknown as Database;

function link(provider: string) {
  return { id: "0b6c1f0e-6a1d-4c35-9a77-2f9a7f1f9a10", userId: "user-1", provider, path: "tool_result", clientName: "Claude", expiresAt: new Date(Date.now() + 60_000) };
}

describe.runIf(!!chromePath)("the connect link's button in a real browser", () => {
  let server: Server;
  let base: string;
  let chrome: Chrome;

  beforeAll(async () => {
    // The router needs the origin the browser will use, which needs the port.
    let router: Router | undefined;
    const app = express();
    app.use(cookieParser());
    app.use((req, res, next) => router!(req, res, next));
    app.use((_req, res) => res.status(200).type("html").send("<p>connect start</p>"));
    server = createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    if (typeof addr === "string" || addr === null) throw new Error("no port");
    base = `http://127.0.0.1:${addr.port}`;
    router = createConnectLinkRouter(dbMock, { baseUrl: base });
    chrome = await launchChrome(chromePath!);
  }, 30_000);

  afterAll(async () => {
    await chrome?.close();
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["atlassian", "Atlassian's own page", "/auth/atlassian/connect?next=%2Fconnect%2Fdone"],
    ["google-workspace", "Google's consent page", "/auth/google/connect?proceed=1&next=%2Fconnect%2Fdone"],
  ])("%s: %s posts with our Origin and is handed to the connect start", async (provider, _page, start) => {
    peekConnectLink.mockResolvedValue(link(provider));
    claimConnectLink.mockResolvedValue(link(provider));
    const page = await chrome.newPage();
    const url = `${base}/connect/${TOKEN}`;

    await chrome.send("Page.navigate", { url }, page);
    await waitForEvent(chrome, page, (evs) => evs.find((e) => e.method === "Page.loadEventFired"));
    const clicked = await chrome.send(
      "Runtime.evaluate",
      { expression: `(() => { const b = document.querySelector('form[method="post"] button'); if (!b) return false; b.click(); return true; })()` },
      page
    );
    expect((clicked.result as { value: unknown }).value).toBe(true);

    // The POST's own request id, then its outcome: a redirect is reported as
    // the next request under the same id, carrying the response it followed.
    const post = await waitForEvent(chrome, page, (evs) =>
      evs.find((e) => e.method === "Network.requestWillBeSent" && (e.params.request as { method: string }).method === "POST")
    );
    const requestId = post.params.requestId;
    const outcome = await waitForEvent(chrome, page, (evs) => {
      const hop = evs.find((e) => e.method === "Network.requestWillBeSent" && e.params.requestId === requestId && e.params.redirectResponse);
      if (hop) return { status: (hop.params.redirectResponse as { status: number }).status, to: (hop.params.request as { url: string }).url };
      const answered = evs.find((e) => e.method === "Network.responseReceived" && e.params.requestId === requestId);
      if (answered) return { status: (answered.params.response as { status: number }).status, to: null };
      return undefined;
    });
    // What went on the wire, as the browser actually sent it.
    const sent = await waitForEvent(chrome, page, (evs) =>
      evs.find((e) => e.method === "Network.requestWillBeSentExtraInfo" && e.params.requestId === requestId)
    );
    const headers = sent.params.headers as Record<string, string>;

    expect({ origin: headers.origin ?? headers.Origin, status: outcome.status }).toEqual({ origin: base, status: 303 });
    expect(outcome.to).toBe(`${base}${start}`);
    expect(claimConnectLink).toHaveBeenCalledTimes(1);
  }, 30_000);
});
