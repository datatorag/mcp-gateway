/**
 * SCRUM-466: the `connect` tool. What must hold: everything connected is one
 * sentence and makes no link; each provider that is not connected gets one
 * link; naming a provider makes a link even when it is connected; a broken
 * connection is named and gets a link; unlaunched providers are left out;
 * the tool is served on the MCP surface to an attended session only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@datatorag-mcp/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const listConnectedAccounts = vi.fn();
vi.mock("./connected-accounts", () => ({
  listConnectedAccounts: (...a: unknown[]) => listConnectedAccounts(...a),
  accountsGrantingScope: vi.fn(async () => []),
}));
const launchedServiceIds = vi.fn();
vi.mock("./service-launch", () => ({
  launchedServiceIds: (...a: unknown[]) => launchedServiceIds(...a),
}));
vi.mock("./track", () => ({
  trackConnectLinkEvent: vi.fn(async () => undefined), trackToolCall: vi.fn(async () => undefined) }));
vi.mock("./mcp-analytics", () => ({ trackMcpToolsListed: vi.fn(async () => undefined) }));
vi.mock("./user-tools", () => ({
  listUserToolRows: vi.fn(async () => []),
  buildPluginServerUrl: () => "http://127.0.0.1:40000/mcp",
  callPluginToolOnce: vi.fn(),
}));
vi.mock("./user-email", () => ({ resolveUserEmail: vi.fn(async () => "member@example.com") }));
vi.mock("./admin", () => ({ isAdmin: vi.fn(async () => false) }));
vi.mock("./billing/enforce", () => ({ checkCallAllowance: vi.fn(async () => ({ allowed: true })) }));
const issueConnectLink = vi.fn();
vi.mock("./connect-links", async (orig) => ({
  ...(await orig<typeof import("./connect-links")>()),
  issueConnectLink: (...a: unknown[]) => issueConnectLink(...a),
}));

import { connectToolResult, CONNECT_TOOL_COPY, CONNECT_TOOL_DESCRIPTION } from "./connect-tool";
import { createMcpServer } from "./mcp-server";
import type { ConnectionPool } from "./pool";

const db = {} as Database;

function account(connectorType: string, email: string, extra: Record<string, unknown> = {}) {
  return {
    connectorType,
    accountEmail: email,
    label: null,
    externalAccountId: null,
    isDefault: true,
    lastRefreshError: null,
    refreshPermanentFailures: 0,
    ...extra,
  };
}

const link = (service: string) => Promise.resolve(`https://gw.example/connect/${service}`);

beforeEach(() => {
  vi.clearAllMocks();
  launchedServiceIds.mockResolvedValue(new Set(["google-workspace", "atlassian", "notion"]));
  listConnectedAccounts.mockResolvedValue([]);
  issueConnectLink.mockImplementation(async (_db: unknown, input: { provider: string }) => ({
    id: "l",
    url: `https://gw.example/connect/${input.provider}`,
  }));
});

describe("connectToolResult", () => {
  it("is one sentence, with no link made, when everything is connected", async () => {
    listConnectedAccounts.mockResolvedValue([
      account("google-workspace", "a@example.com"),
      account("atlassian", "a@example.com"),
      account("notion", "a@example.com", { externalAccountId: "ws", label: "Team" }),
    ]);
    const issue = vi.fn(link);
    const result = await connectToolResult(db, "u", undefined, issue);
    expect(result.content[0].text).toBe("Google Workspace, Atlassian and Notion are all connected. Nothing to do.");
    expect(issue).not.toHaveBeenCalled();
  });

  it("gives one link for each provider that is not connected, and none for the others", async () => {
    listConnectedAccounts.mockResolvedValue([
      account("google-workspace", "a@example.com"),
      account("google-workspace", "b@example.com", { isDefault: false }),
    ]);
    const issue = vi.fn(link);
    const result = await connectToolResult(db, "u", undefined, issue);
    expect(result.content[0].text).toBe(
      [
        "Google Workspace: connected as a@example.com (default), b@example.com.",
        "Atlassian: not connected. Connect it here: https://gw.example/connect/atlassian",
        "Notion: not connected. Connect it here: https://gw.example/connect/notion",
      ].join("\n")
    );
    expect(issue.mock.calls.map((c) => c[0])).toEqual(["atlassian", "notion"]);
    const providers = (result.structuredContent as { providers: Array<{ id: string; connected: boolean; connect_url: string | null }> }).providers;
    expect(providers.map((p) => [p.id, p.connected, p.connect_url])).toEqual([
      ["google-workspace", true, null],
      ["atlassian", false, "https://gw.example/connect/atlassian"],
      ["notion", false, "https://gw.example/connect/notion"],
    ]);
  });

  it("makes a link for a named provider even when it is connected", async () => {
    listConnectedAccounts.mockResolvedValue([account("google-workspace", "a@example.com")]);
    const result = await connectToolResult(db, "u", "google-workspace", link);
    expect(result.content[0].text).toBe(
      "Google Workspace: connected as a@example.com (default). Connect another account here: https://gw.example/connect/google-workspace"
    );
  });

  it("names a broken connection and gives a link to reconnect it", async () => {
    listConnectedAccounts.mockResolvedValue([
      account("atlassian", "a@example.com", { refreshPermanentFailures: 2 }),
    ]);
    const result = await connectToolResult(db, "u", "atlassian", link);
    expect(result.content[0].text).toBe(
      "Atlassian: connected as a@example.com (default, needs reconnecting). Reconnect it here: https://gw.example/connect/atlassian"
    );
  });

  it("leaves out a provider that has not launched", async () => {
    launchedServiceIds.mockResolvedValue(new Set(["google-workspace", "atlassian"]));
    const result = await connectToolResult(db, "u", undefined, link);
    expect(result.content[0].text).not.toContain("Notion");
    expect((await connectToolResult(db, "u", "notion", link)).isError).toBe(true);
  });

  it("says so when a link could not be made", async () => {
    const result = await connectToolResult(db, "u", "notion", async () => null);
    expect(result.content[0].text).toBe(`Notion: not connected. ${CONNECT_TOOL_COPY.linkFailed}`);
  });

  it("carries no em-dash or en-dash in its words", () => {
    const words = [
      CONNECT_TOOL_DESCRIPTION,
      ...Object.values(CONNECT_TOOL_COPY).map((v) => (typeof v === "function" ? (v as (a: string, b?: string) => string)("X", "Y") : v)),
    ].join("\n");
    expect(words).not.toMatch(/[–—]/);
  });
});

describe("the connect built-in", () => {
  const pool = { acquire: vi.fn(), release: vi.fn() } as unknown as ConnectionPool;

  async function client(opts: Parameters<typeof createMcpServer>[3]) {
    const server = createMcpServer("user-1", db, pool, opts);
    const c = new Client({ name: "claude-ai", version: "1.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    await c.connect(ct);
    return c;
  }

  it("is listed on the MCP surface as a read, and answers with a link made for this user", async () => {
    const c = await client({ baseUrl: "https://gw.example" });
    const listed = (await c.listTools()).tools.find((t) => t.name === "connect");
    expect(listed?.annotations?.readOnlyHint).toBe(true);
    const result = await c.callTool({ name: "connect", arguments: { service: "notion" } });
    expect((result.content as Array<{ text: string }>)[0].text).toContain("https://gw.example/connect/notion");
    expect(issueConnectLink).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      provider: "notion",
      path: "tool_result",
      clientName: "claude-ai",
      baseUrl: "https://gw.example",
    });
  });

  it("is neither listed nor callable on the agent's surface or in a skill run", async () => {
    for (const opts of [{ surface: "agent" as const }, { baseUrl: "https://gw.example", unattended: true }]) {
      const c = await client(opts);
      expect((await c.listTools()).tools.some((t) => t.name === "connect")).toBe(false);
      const result = await c.callTool({ name: "connect", arguments: {} });
      expect(result.isError).toBe(true);
    }
    expect(issueConnectLink).not.toHaveBeenCalled();
  });
});
