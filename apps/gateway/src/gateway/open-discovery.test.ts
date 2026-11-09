/**
 * Discovery before sign-in on /mcp (SCRUM-481), over real HTTP.
 *
 * The app below is the /mcp wiring from server.ts with the same parts: the
 * real bearer gate, `openDiscoveryRequest`, the open-discovery handler and
 * `sendMcpUnauthorized`. Only the authenticated branch is a stub, because what
 * is pinned here is everything a caller WITHOUT a bearer can reach.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Database } from "@datatorag-mcp/db";

vi.mock("./mcp-analytics", async (orig) => ({
  ...(await orig<typeof import("./mcp-analytics")>()),
  trackMcpToolsListed: vi.fn().mockResolvedValue(undefined),
}));

import {
  DISCOVERY_LIMITS,
  OPEN_DISCOVERY_METHODS,
  cachedFor,
  createOpenDiscovery,
  discoveryOriginAllowed,
  openDiscoveryMethod,
  openDiscoveryRequest,
  publicInstructionsFor,
} from "./open-discovery";
import { mcpBearerGate, type BearerAuth, type McpAuthState } from "./bearer-auth";
import { sendMcpUnauthorized } from "./mcp-unauthorized";
import {
  BUILT_IN_TOOLS,
  MCP_SERVER_CAPABILITIES,
  MCP_SERVER_INFO,
  createMcpServer,
  listedTools,
} from "./mcp-server";
import { discoveryId } from "./auth-failure-context";
import type { McpDiscovery } from "./mcp-analytics";
import type { ConnectionPool } from "./pool";

const BASE = "https://gateway.example";
const URLS = { resourceMetadataUrl: `${BASE}/.well-known/oauth-protected-resource`, baseUrl: BASE };
const SALT = "test-salt";

const ROWS = [
  {
    namespacedName: "gws-mcp__gmail_search",
    description: "Search mail.",
    schema: { type: "object", properties: { query: { type: "string", description: "A Gmail query." } } },
    requiredService: "google-workspace",
    readOnlyHint: true,
    destructiveHint: null,
  },
];
const PUBLIC_BUILTINS = BUILT_IN_TOOLS.filter((t) => !t.audience && (!t.surfaces || t.surfaces.includes("mcp")));

let now = 1_800_000_000_000;
let listFails = false;
let instructionsFail = false;
const tracked: McpDiscovery[] = [];
const authed = vi.fn();

const validate = async (raw: string): Promise<BearerAuth> =>
  raw === "good-token"
    ? { ok: true, userId: "user-1", clientId: "client-1" }
    : { ok: false, reason: "expired", userId: "user-1" };

function buildApp() {
  const openDiscovery = createOpenDiscovery({
    baseUrl: BASE,
    salt: SALT,
    serverSha: "sha-test",
    listTools: async () => {
      if (listFails) throw new Error('column tools.secret_column does not exist');
      return listedTools(ROWS, PUBLIC_BUILTINS);
    },
    listPrompts: async () => [],
    instructions: async () => {
      if (instructionsFail) throw new Error("registry down");
      return "DataToRAG gives you tools.";
    },
    serverInfo: MCP_SERVER_INFO,
    capabilities: MCP_SERVER_CAPABILITIES,
    track: (d) => tracked.push(d),
    clock: () => now,
  });
  const app = express();
  app.use("/mcp", mcpBearerGate(validate, { authed: express.json(), unauthed: express.json() }));
  app.all("/mcp", async (req, res) => {
    const state = res.locals.mcpAuth as McpAuthState;
    if (state.header === "missing") {
      const method = openDiscoveryRequest(req);
      if (method) {
        await openDiscovery.handle(req, res, method);
        return;
      }
      sendMcpUnauthorized(res, URLS, "unauthorized");
      return;
    }
    if (!state.auth.ok) {
      sendMcpUnauthorized(res, URLS, "invalid_token", [`error="invalid_token"`]);
      return;
    }
    authed();
    res.json({ authed: true });
  });
  return app;
}

let server: HttpServer;
let url: string;
beforeAll(async () => {
  server = buildApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  tracked.length = 0;
  listFails = false;
  instructionsFail = false;
  authed.mockClear();
  // A fresh minute and hour for every test, so the limit test owns its counts.
  now += 2 * 60 * 60_000;
});

const HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };
const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "probe", version: "1.2" } },
};
function rpc(method: string, id: number | null = 1, params: Record<string, unknown> = {}) {
  return id === null ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params };
}
function post(body: unknown, headers: Record<string, string> = {}) {
  return fetch(url, { method: "POST", headers: { ...HEADERS, ...headers }, body: JSON.stringify(body) });
}
async function expectChallenge(res: Response) {
  expect(res.status).toBe(401);
  const challenge = res.headers.get("www-authenticate") ?? "";
  expect(challenge).toMatch(/^Bearer /);
  expect(challenge).toContain(`resource_metadata="${URLS.resourceMetadataUrl}"`);
  const body = await res.json();
  expect(body).toMatchObject({ error: "unauthorized", resource_metadata: URLS.resourceMetadataUrl });
  // Never a JSON-RPC result, so never a 200 carrying isError.
  expect(body.result).toBeUndefined();
}

describe("the open methods answer without a bearer", () => {
  it("initialize answers 200 with the server's identity and capabilities, and issues no session", async () => {
    const res = await post(INITIALIZE, { "user-agent": "probe-agent/1.0" });
    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBeNull();
    // Nothing that names or keeps a caller: no cookie, no session.
    expect(res.headers.get("set-cookie")).toBeNull();
    const body = await res.json();
    expect(body.result.serverInfo).toEqual(MCP_SERVER_INFO);
    expect(body.result.capabilities).toMatchObject({ tools: {}, prompts: {} });
    expect(body.result.instructions).toBe("DataToRAG gives you tools.");
  });

  it("tools/list answers the public list, with no initialize before it", async () => {
    const res = await post(rpc("tools/list"));
    expect(res.status).toBe(200);
    const { result } = await res.json();
    const names = result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("gws-mcp__gmail_search");
    expect(names).toContain("echo");
    // The same shaping a session gets: the account parameter on a service tool.
    const gmail = result.tools.find((t: { name: string }) => t.name === "gws-mcp__gmail_search");
    expect(gmail.inputSchema.properties.account).toBeDefined();
    expect(gmail.annotations).toEqual({ readOnlyHint: true });
    // No admin-only built-in reaches the open list.
    for (const t of BUILT_IN_TOOLS.filter((b) => b.audience)) expect(names).not.toContain(t.definition.name);
  });

  it("a failed read answers in fixed words, never the database's", async () => {
    listFails = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const body = await (await post(rpc("tools/list"))).json();
    spy.mockRestore();
    expect(body.error.message).toContain("tools/list is unavailable right now");
    expect(JSON.stringify(body)).not.toContain("secret_column");
  });

  it("a failed instructions read still answers initialize, without instructions", async () => {
    instructionsFail = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post(INITIALIZE);
    spy.mockRestore();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.serverInfo).toEqual(MCP_SERVER_INFO);
    expect(body.result.instructions).toBeUndefined();
  });

  it("an Authorization header that is not a bearer counts as none: discovery answers, a call is a 401", async () => {
    expect((await post(rpc("tools/list"), { authorization: "Basic Zm9v" })).status).toBe(200);
    await expectChallenge(await post(rpc("tools/call", 1, { name: "echo" }), { authorization: "Basic Zm9v" }));
  });

  it("ping and prompts/list answer 200, and notifications/initialized is accepted", async () => {
    expect((await post(rpc("ping"))).status).toBe(200);
    expect((await post(rpc("prompts/list"))).status).toBe(200);
    expect((await post(rpc("notifications/initialized", null))).status).toBe(202);
  });

  it("a real MCP client connects and lists without credentials, and its tool call is a real 401", async () => {
    const client = new Client({ name: "sdk-probe", version: "0.0.1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    const { tools } = await client.listTools();
    expect(tools.length).toBe(ROWS.length + PUBLIC_BUILTINS.length);
    await expect(client.callTool({ name: "echo", arguments: { message: "hi" } })).rejects.toMatchObject({ code: 401 });
    await client.close();
  });
});

describe("everything else stays closed", () => {
  it("tools/call without a bearer is an HTTP 401 with the challenge, never a 200 error result", async () => {
    await expectChallenge(await post(rpc("tools/call", 1, { name: "echo", arguments: { message: "x" } })));
  });

  // The pinned list, written out rather than read from the module, so
  // opening a method there turns this red.
  const OPEN = ["initialize", "notifications/initialized", "ping", "tools/list", "prompts/list"];

  it("the open list is exactly the pinned one", () => {
    expect([...OPEN_DISCOVERY_METHODS].sort()).toEqual([...OPEN].sort());
  });

  it("walks every method the server handles and every client method in the spec: only the open list is open", async () => {
    const fakeDb = {} as Database;
    const session = createMcpServer("user-1", fakeDb, {} as ConnectionPool);
    const handled = [...(session as unknown as { _requestHandlers: Map<string, unknown> })._requestHandlers.keys()];
    const spec = [
      "initialize",
      "ping",
      "tools/list",
      "tools/call",
      "prompts/list",
      "prompts/get",
      "resources/list",
      "resources/templates/list",
      "resources/read",
      "resources/subscribe",
      "resources/unsubscribe",
      "completion/complete",
      "logging/setLevel",
      "tasks/get",
      "tasks/result",
      "tasks/list",
      "tasks/cancel",
    ];
    const notifications = ["notifications/initialized", "notifications/cancelled", "notifications/progress", "notifications/roots/list_changed"];
    // The walk must cover what the server answers today, or a new handler
    // could be opened by accident and this test would not see it.
    for (const m of handled) expect(spec).toContain(m);

    for (const method of [...new Set([...spec, ...handled])]) {
      const res = await post(rpc(method, 7, method === "initialize" ? INITIALIZE.params : {}));
      if (OPEN.includes(method)) {
        expect(res.status, method).toBe(200);
      } else {
        await expectChallenge(res);
      }
    }
    for (const method of notifications) {
      const res = await post(rpc(method, null));
      if (OPEN.includes(method)) expect(res.status, method).toBe(202);
      else await expectChallenge(res);
    }
  });

  it("a GET (the event stream) and a DELETE without a bearer keep the 401", async () => {
    await expectChallenge(await fetch(url, { method: "GET", headers: { accept: "text/event-stream" } }));
    await expectChallenge(await fetch(url, { method: "DELETE" }));
  });

  it("a batch is not discovery, even of open methods", async () => {
    await expectChallenge(await post([rpc("tools/list", 1), rpc("ping", 2)]));
  });

  it("a failing bearer is not discovery: initialize keeps the invalid_token 401", async () => {
    const res = await post(INITIALIZE, { authorization: "Bearer stale-token" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(`error="invalid_token"`);
    expect(tracked).toHaveLength(0);
  });

  it("an authenticated request never goes through discovery and fires no discovery event", async () => {
    const res = await post(rpc("tools/list"), { authorization: "Bearer good-token" });
    expect(res.status).toBe(200);
    expect(authed).toHaveBeenCalledTimes(1);
    expect(tracked).toHaveLength(0);
  });
});

describe("Origin (the transport spec's DNS-rebinding rule)", () => {
  it("refuses another site's browser origin with a 403", async () => {
    const res = await post(rpc("tools/list"), { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(tracked.map((t) => t.outcome)).toEqual(["origin_refused"]);
  });

  it("allows no origin, ours, and a loopback page", async () => {
    expect((await post(rpc("ping"), { origin: BASE })).status).toBe(200);
    expect((await post(rpc("ping"), { origin: "http://localhost:6274" })).status).toBe(200);
    expect(discoveryOriginAllowed(undefined, BASE)).toBe(true);
    expect(discoveryOriginAllowed("http://127.0.0.1:3000", BASE)).toBe(true);
    expect(discoveryOriginAllowed("https://gateway.example.evil.example", BASE)).toBe(false);
    expect(discoveryOriginAllowed("null", BASE)).toBe(false);
    expect(discoveryOriginAllowed("file://localhost", BASE)).toBe(false);
  });
});

describe("rate limit, per IP", () => {
  it(`answers ${DISCOVERY_LIMITS.perMinute} a minute, then 429 with Retry-After, and records one limited event`, async () => {
    const ip = { "cf-connecting-ip": "198.51.100.9" };
    for (let i = 0; i < DISCOVERY_LIMITS.perMinute; i++) {
      expect((await post(rpc("ping"), ip)).status).toBe(200);
    }
    const limited = await post(rpc("ping"), ip);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    await post(rpc("ping"), ip);
    expect(tracked.filter((t) => t.outcome === "rate_limited")).toHaveLength(1);
    expect(tracked.filter((t) => t.outcome === "served")).toHaveLength(DISCOVERY_LIMITS.perMinute);
    // Another address is not limited by this one.
    expect((await post(rpc("ping"), { "cf-connecting-ip": "198.51.100.10" })).status).toBe(200);
  });

  it(`answers ${DISCOVERY_LIMITS.perHour} an hour`, async () => {
    const ip = { "cf-connecting-ip": "198.51.100.11" };
    for (let i = 0; i < DISCOVERY_LIMITS.perHour; i++) {
      if (i % DISCOVERY_LIMITS.perMinute === 0) now += 61_000;
      expect((await post(rpc("ping"), ip)).status).toBe(200);
    }
    now += 61_000;
    expect((await post(rpc("ping"), ip)).status).toBe(429);
  });
});

describe("the mcp_discovery event", () => {
  it("fires on an open initialize and an open tools/list with every property", async () => {
    const headers = { "user-agent": "probe-agent/1.0", "cf-connecting-ip": "203.0.113.7" };
    await post(INITIALIZE, headers);
    await post(rpc("tools/list"), { ...headers, "mcp-protocol-version": "2025-06-18" });
    expect(tracked.map((t) => t.method)).toEqual(["initialize", "tools/list"]);
    const expectedId = discoveryId("203.0.113.7", "probe-agent/1.0", SALT);
    expect(tracked[0]).toMatchObject({
      clientName: "probe",
      clientVersion: "1.2",
      userAgent: "probe-agent/1.0",
      protocolVersion: "2025-06-18",
      outcome: "served",
      serverSha: "sha-test",
      discoveryId: expectedId,
    });
    // tools/list carries no clientInfo: empty, and the version from the header.
    expect(tracked[1]).toMatchObject({ clientName: "", clientVersion: "", protocolVersion: "2025-06-18", discoveryId: expectedId });
  });

  it("names the caller by a hash, never by its address", async () => {
    await post(rpc("ping"), { "cf-connecting-ip": "203.0.113.7", "user-agent": "x" });
    expect(tracked[0].discoveryId).toMatch(/^[0-9a-f]{32}$/);
    expect(tracked[0].peerHash).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(tracked)).not.toContain("203.0.113");
  });
});

describe("what a directory scores on the open list", () => {
  it("every public built-in has a description, every argument described, and annotations when served", () => {
    for (const tool of listedTools([], PUBLIC_BUILTINS)) {
      expect(tool.description.trim(), tool.name).not.toBe("");
      const props = (tool.inputSchema.properties ?? {}) as Record<string, { description?: string }>;
      for (const [arg, schema] of Object.entries(props)) expect(schema.description?.trim(), `${tool.name}.${arg}`).toBeTruthy();
      expect(tool.annotations, tool.name).toBeDefined();
    }
  });
});

describe("helpers", () => {
  it("openDiscoveryMethod reads one JSON-RPC message only", () => {
    expect(openDiscoveryMethod(rpc("tools/list"))).toBe("tools/list");
    expect(openDiscoveryMethod({ method: "tools/list" })).toBeNull();
    expect(openDiscoveryMethod([rpc("tools/list")])).toBeNull();
    expect(openDiscoveryMethod(rpc("tools/call"))).toBeNull();
    expect(openDiscoveryMethod(undefined)).toBeNull();
  });

  it("cachedFor reads once per window and does not cache a failure", async () => {
    let t = 0;
    let n = 0;
    let fail = true;
    const read = cachedFor(1000, async () => {
      n++;
      if (fail) throw new Error("db down");
      return n;
    }, () => t);
    await expect(read()).rejects.toThrow("db down");
    fail = false;
    expect(await read()).toBe(2);
    expect(await read()).toBe(2);
    t = 1001;
    expect(await read()).toBe(3);
  });

  it("the open instructions name only public providers", async () => {
    const text = await publicInstructionsFor(
      async () => new Set(["google-workspace", "brevo"]),
      ["google-workspace"],
      (ids) => [...ids].join(",")
    );
    expect(text).toBe("google-workspace");
  });
});
