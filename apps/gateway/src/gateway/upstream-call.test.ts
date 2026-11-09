/**
 * official-mcp-proxy: one call to a vendor's own MCP server, against a fake
 * vendor made from the SDK's own server over real HTTP. What is pinned: the
 * user's token reaches the vendor as a bearer and nothing of a plugin's
 * does, and every transport outcome carries the failure marker the gateway
 * meters on, in fixed words.
 */
import { createServer, type Server, type IncomingHttpHeaders } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { callUpstreamTool, upstreamUrl, UPSTREAM_MAX_RESPONSE_CHARS } from "./upstream-call";
import { classifyOutcome, pluginFailureOf } from "./usage/classify";

let server: Server;
let base: string;
const seen: IncomingHttpHeaders[] = [];
const seenUrls: string[] = [];

function vendor() {
  const mcp = new McpServer({ name: "fake-vendor", version: "1.0.0" });
  mcp.tool("vendor_read", { q: z.string().optional() }, async () => ({ content: [{ type: "text", text: "read ok" }] }));
  mcp.tool("vendor_slow", {}, async () => {
    await new Promise((r) => setTimeout(r, 2_000));
    return { content: [{ type: "text", text: "late" }] };
  });
  mcp.tool("vendor_big", {}, async () => ({ content: [{ type: "text", text: "x".repeat(UPSTREAM_MAX_RESPONSE_CHARS + 50_000) }] }));
  mcp.tool("vendor_refuses", {}, async () => ({ content: [{ type: "text", text: "channel_not_found" }], isError: true }));
  return mcp;
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.post("/mcp", async (req, res) => {
    seen.push(req.headers);
    seenUrls.push(req.originalUrl);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const mcp = vendor();
    res.on("close", () => void transport.close());
    await mcp.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.post("/mcp-401", (_req, res) => void res.status(401).json({ error: "invalid_auth" }));
  app.post("/mcp-429", (_req, res) => void res.status(429).set("Retry-After", "30").send("slow down"));
  app.post("/mcp-503", (_req, res) => void res.status(503).send("<html>down</html>"));
  app.post("/mcp-html", (_req, res) => void res.status(200).type("html").send("<html>a proxy page</html>"));
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
  seen.length = 0;
  seenUrls.length = 0;
});

const call = (path: string, toolName: string, deadlineMs?: number, params?: Record<string, string>) =>
  callUpstreamTool({
    upstream: { url: `${base}${path}`, auth: "oauth-confidential", ...(params ? { params } : {}) },
    serviceName: "Slack",
    token: "fixture-user-token",
    toolName,
    args: {},
    clientName: "datatorag-mcp",
    ...(deadlineMs ? { deadlineMs } : {}),
  });

const meter = (result: Awaited<ReturnType<typeof call>>) =>
  classifyOutcome({ thrown: false, isError: !!result.isError, errorMessage: null, source: "mcp", failure: pluginFailureOf(result) })
    .meter;

describe("a call to a vendor's MCP server", () => {
  it("answers with the vendor's result, and the token reached it as a bearer and nothing else did", async () => {
    const result = await call("/mcp", "vendor_read");
    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([{ type: "text", text: "read ok" }]);
    expect(seen.length).toBeGreaterThan(0);
    for (const h of seen) {
      expect(h.authorization).toBe("Bearer fixture-user-token");
      expect(h["x-user-token"]).toBeUndefined();
      expect(Object.keys(h).filter((k) => k.startsWith("x-posthog"))).toEqual([]);
    }
  });

  it("sends the declared params on the declared URL, and only there", async () => {
    await call("/mcp", "vendor_read", undefined, { readonly: "true" });
    for (const u of seenUrls) expect(u).toBe("/mcp?readonly=true");
    expect(upstreamUrl({ url: "https://mcp.example.com/mcp?a=1", auth: "bearer-pasted", params: { b: "2" } }).toString()).toBe(
      "https://mcp.example.com/mcp?a=1&b=2"
    );
  });

  it("a vendor's own tool error passes through in its words, and is the request's own", async () => {
    const result = await call("/mcp", "vendor_refuses");
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "channel_not_found" }]);
    expect(pluginFailureOf(result)).toBeNull();
    expect(meter(result)).toBe(true);
  });
});

describe("what a transport failure becomes", () => {
  it("a revoked or expired token: an HTTP 401, which the dispatch turns into a reconnect", async () => {
    const result = await call("/mcp-401", "vendor_read");
    expect(pluginFailureOf(result)).toEqual({ kind: "http", status: 401 });
    expect(JSON.stringify(result)).not.toContain("invalid_auth");
  });

  it("rate-limited: an HTTP 429, not metered", async () => {
    const result = await call("/mcp-429", "vendor_read");
    expect(pluginFailureOf(result)).toEqual({ kind: "http", status: 429 });
    expect(result.content[0]).toEqual({ type: "text", text: "Slack is rate-limiting these calls. Try again in a moment." });
    expect(meter(result)).toBe(false);
  });

  it("a vendor error page: an HTTP 5xx, not metered, and the page is never passed on", async () => {
    const result = await call("/mcp-503", "vendor_read");
    expect(pluginFailureOf(result)).toEqual({ kind: "http", status: 503 });
    expect(JSON.stringify(result)).not.toContain("<html>");
    expect(meter(result)).toBe(false);
  });

  it("an answer that is not MCP: unreachable, not metered, the HTML not passed on", async () => {
    const result = await call("/mcp-html", "vendor_read");
    expect(pluginFailureOf(result)?.kind).toBe("unreachable");
    expect(JSON.stringify(result)).not.toContain("proxy page");
    expect(meter(result)).toBe(false);
  });

  it("nothing listening: unreachable, not metered", async () => {
    const result = await callUpstreamTool({
      upstream: { url: "http://127.0.0.1:1/mcp", auth: "oauth-confidential" },
      serviceName: "Slack",
      token: "t",
      toolName: "vendor_read",
      args: {},
      clientName: "datatorag-mcp",
    });
    expect(pluginFailureOf(result)?.kind).toBe("unreachable");
    expect(meter(result)).toBe(false);
  });

  it("too slow: the deadline holds, transient, not metered", async () => {
    const started = Date.now();
    const result = await call("/mcp", "vendor_slow", 500);
    expect(Date.now() - started).toBeLessThan(1_800);
    expect(pluginFailureOf(result)?.kind).toBe("transient");
    expect(meter(result)).toBe(false);
  });

  it("a tool the vendor no longer has: unknown_tool, not metered", async () => {
    const result = await call("/mcp", "vendor_gone");
    expect(pluginFailureOf(result)?.kind).toBe("unknown_tool");
    expect(result.content[0]).toEqual({ type: "text", text: "This Slack tool is no longer offered." });
    expect(meter(result)).toBe(false);
  });

  it("an answer over 900KB is cut, with the marker", async () => {
    const result = await call("/mcp", "vendor_big");
    const text = (result.content[0] as { text: string }).text;
    expect(text.length).toBeLessThanOrEqual(UPSTREAM_MAX_RESPONSE_CHARS + 100);
    expect(text.endsWith("... [truncated: response exceeded 900KB]")).toBe(true);
  });
});
