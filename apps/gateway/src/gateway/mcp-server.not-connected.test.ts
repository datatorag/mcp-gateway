/**
 * SCRUM-466: every refusal for a provider that is not connected, or whose
 * connection is broken, goes out in one shape. On the MCP surface it carries
 * a fresh connect link in the text and as structured content; on the agent's
 * surface its text is today's. Each is tracked and never metered, and the
 * scheduler still reads the service from every one of them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Database } from "@datatorag-mcp/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const trackToolCall = vi.fn().mockResolvedValue(undefined);
const trackConnectLinkEvent = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("./track", () => ({
  trackConnectLinkEvent: (...a: unknown[]) => trackConnectLinkEvent(...a),
  trackToolCall: (...args: unknown[]) => trackToolCall(...args),
}));
vi.mock("./mcp-analytics", () => ({
  trackMcpToolsListed: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./connected-accounts", () => ({
  listConnectedAccounts: vi.fn().mockResolvedValue([]),
  accountsGrantingScope: vi.fn().mockResolvedValue([]),
}));
const callPluginToolOnce = vi.fn();
vi.mock("./user-tools", () => ({
  listUserToolRows: vi.fn().mockResolvedValue([]),
  buildPluginServerUrl: () => "http://127.0.0.1:40000/mcp",
  callPluginToolOnce: (...args: unknown[]) => callPluginToolOnce(...args),
}));
vi.mock("./billing/enforce", () => ({
  checkCallAllowance: vi.fn().mockResolvedValue({ allowed: true }),
}));
const resolveServiceToken = vi.fn();
vi.mock("./service-token", async () => ({
  PLUGIN_SERVICE_MAP: { "gws-mcp": "google-workspace", "notion-mcp": "notion" },
  resolveServiceToken: (...args: unknown[]) => resolveServiceToken(...args),
  ambiguousAccountMessage: (await vi.importActual<typeof import("./service-token")>("./service-token"))
    .ambiguousAccountMessage,
}));
vi.mock("./user-email", () => ({
  resolveUserEmail: vi.fn().mockResolvedValue("member@example.com"),
}));
const issueConnectLink = vi.fn();
vi.mock("./connect-links", async (orig) => ({
  ...(await orig<typeof import("./connect-links")>()),
  issueConnectLink: (...a: unknown[]) => issueConnectLink(...a),
}));

import { connectionFailureService, createMcpServer } from "./mcp-server";
import { classifyOutcome } from "./usage/classify";
import type { ConnectionPool } from "./pool";

const BASE = "https://gw.example.test";
const LINK = `${BASE}/connect/${"L".repeat(43)}`;

const selectLimit = vi.fn();
const dbMock = {
  select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }),
} as unknown as Database;
const poolMock = { acquire: vi.fn(), release: vi.fn() } as unknown as ConnectionPool;

async function connectedClient(surface: "mcp" | "agent" = "mcp") {
  const server = createMcpServer("user-1", dbMock, poolMock, surface === "mcp" ? { baseUrl: BASE } : { surface });
  const client = new Client({ name: "claude-ai", version: "1.0.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);
  return client;
}

function textOf(result: unknown): string {
  return ((result as { content: Array<{ text?: string }> }).content ?? []).map((c) => c.text).join(" ");
}

beforeEach(() => {
  vi.clearAllMocks();
  selectLimit.mockResolvedValue([{ id: "srv-1", slug: "gws-mcp", containerPort: 40000, githubRepoUrl: null }]);
  issueConnectLink.mockResolvedValue({ id: "link-1", url: LINK });
});

const CASES: Array<{
  reason: string;
  args: Record<string, unknown>;
  resolution: unknown;
}> = [
  { reason: "not_connected", args: { query: "q" }, resolution: null },
  { reason: "no_such_account", args: { query: "q", account: "other@example.com" }, resolution: null },
  {
    reason: "reconnect",
    args: { query: "q" },
    resolution: { refreshFailed: true, service: "google-workspace", accountEmail: "a@example.com", reconnectNeeded: true },
  },
  {
    reason: "missing_scope",
    args: { query: "q" },
    resolution: { token: "tok", accountEmail: "a@example.com", scopes: "openid https://www.googleapis.com/auth/userinfo.email" },
  },
];

describe("a not-connected refusal on the MCP surface", () => {
  for (const c of CASES) {
    it(`${c.reason}: the sentence, then the link, as text and as fields`, async () => {
      resolveServiceToken.mockResolvedValue(c.resolution);
      const client = await connectedClient();
      const result = await client.callTool({ name: "gws-mcp__drive_search", arguments: c.args });

      expect(result.isError).toBe(true);
      const text = textOf(result);
      expect(text).toContain(`Connect it here: ${LINK}`);
      // The dashboard URL stays, so the scheduler still reads the service.
      expect(text).toContain(`${BASE}/dashboard/connections/google-workspace`);
      // Adding the link changes nothing the scheduler reads.
      const sentence = text.slice(0, text.indexOf(" Connect it here: "));
      expect(connectionFailureService(text)).toBe(connectionFailureService(sentence));
      if (c.reason !== "missing_scope") expect(connectionFailureService(text)).toBe("google-workspace");
      expect(result.structuredContent).toEqual({
        error: "not_connected",
        reason: c.reason,
        provider: "google-workspace",
        next: "connect",
        connect_url: LINK,
      });
      expect(issueConnectLink).toHaveBeenCalledWith(expect.anything(), {
        userId: "user-1",
        provider: "google-workspace",
        path: "tool_result",
        clientName: "claude-ai",
        baseUrl: BASE,
      });
      expect(callPluginToolOnce).not.toHaveBeenCalled();
      expect(trackConnectLinkEvent).toHaveBeenCalledWith("user-1", "connect_link_issued", {
        provider: "google-workspace",
        path: "tool_result",
        clientName: "claude-ai",
      });

      // Tracked, as a user error that never uses the allowance.
      expect(trackToolCall).toHaveBeenCalledTimes(1);
      const [, props] = trackToolCall.mock.calls[0];
      expect(props.outcome.notConnected).toBe(true);
      expect(classifyOutcome(props.outcome)).toEqual({ status: "user_error", meter: false });
    });
  }

  it("still says where to connect when no link could be issued", async () => {
    resolveServiceToken.mockResolvedValue(null);
    issueConnectLink.mockRejectedValue(new Error("db down"));
    const client = await connectedClient();
    const result = await client.callTool({ name: "gws-mcp__drive_search", arguments: { query: "q" } });
    expect(textOf(result)).toContain(`${BASE}/dashboard/connections/google-workspace`);
    expect(textOf(result)).not.toContain("Connect it here");
    expect(result.structuredContent).toBeUndefined();
  });

  it("leaves a provider that did not answer a refresh as a retry, untracked as before", async () => {
    resolveServiceToken.mockResolvedValue({
      refreshFailed: true,
      service: "google-workspace",
      accountEmail: "a@example.com",
      reconnectNeeded: false,
    });
    const client = await connectedClient();
    const result = await client.callTool({ name: "gws-mcp__drive_search", arguments: { query: "q" } });
    expect(textOf(result)).toContain("did not respond to a token refresh");
    expect(result.structuredContent).toBeUndefined();
    expect(issueConnectLink).not.toHaveBeenCalled();
  });
});

describe("the agent's surface", () => {
  it("keeps today's text, with no link and no fields", async () => {
    resolveServiceToken.mockResolvedValue(null);
    const client = await connectedClient("agent");
    const result = await client.callTool({ name: "gws-mcp__drive_search", arguments: { query: "q" } });
    expect(textOf(result)).toBe(
      "google-workspace is not connected. Please connect it from the dashboard at /dashboard/connections/google-workspace before using gws-mcp tools."
    );
    expect(result.structuredContent).toBeUndefined();
    expect(issueConnectLink).not.toHaveBeenCalled();
  });
});

describe("a provider that refuses a token it issued", () => {
  it("keeps the plugin's words and adds the link, unmetered", async () => {
    resolveServiceToken.mockResolvedValue({ token: "tok", accountEmail: "a@example.com", scopes: null });
    selectLimit.mockResolvedValue([{ id: "srv-2", slug: "notion-mcp", containerPort: 40001, githubRepoUrl: null }]);
    callPluginToolOnce.mockResolvedValue({
      content: [{ type: "text", text: "Notion no longer accepts this connection. Reconnect Notion." }],
      isError: true,
      _meta: { "datatorag.com/error": { kind: "http", status: 401 } },
    });
    const client = await connectedClient();
    const result = await client.callTool({ name: "notion-mcp__notion_search", arguments: { query: "q" } });
    expect(textOf(result)).toBe(`Notion no longer accepts this connection. Reconnect Notion. Connect it here: ${LINK}`);
    expect(result.structuredContent).toMatchObject({ reason: "reconnect", provider: "notion", connect_url: LINK });
    const [, props] = trackToolCall.mock.calls[0];
    expect(classifyOutcome(props.outcome).meter).toBe(false);
  });

  it("leaves every other plugin failure as it was", async () => {
    resolveServiceToken.mockResolvedValue({ token: "tok", accountEmail: "a@example.com", scopes: null });
    selectLimit.mockResolvedValue([{ id: "srv-2", slug: "notion-mcp", containerPort: 40001, githubRepoUrl: null }]);
    callPluginToolOnce.mockResolvedValue({
      content: [{ type: "text", text: "Not found." }],
      isError: true,
      _meta: { "datatorag.com/error": { kind: "http", status: 404 } },
    });
    const client = await connectedClient();
    const result = await client.callTool({ name: "notion-mcp__notion_search", arguments: { query: "q" } });
    expect(textOf(result)).toBe("Not found.");
    expect(issueConnectLink).not.toHaveBeenCalled();
  });
});
