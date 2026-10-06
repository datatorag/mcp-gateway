/**
 * SCRUM-392: a call with a missing required argument, or an argument the
 * tool does not take, is refused by the gateway before any plugin is
 * reached, against the registry's own schema.
 *
 * Same harness shape as the file-crossing dispatch test: a real MCP client
 * over an in-memory transport, the database and the plugin call mocked.
 * The database's `select().from().where().limit()` answers in ORDER: the
 * server row first, then the tool row, which is how the dispatch asks.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Database } from "@datatorag-mcp/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const trackToolCall = vi.fn().mockResolvedValue(undefined);
vi.mock("./track", () => ({
  trackToolCall: (...args: unknown[]) => trackToolCall(...args),
}));
vi.mock("./mcp-analytics", () => ({
  trackMcpAnalytics: vi.fn(),
}));
vi.mock("./connected-accounts", () => ({
  accountsGrantingScope: vi.fn().mockResolvedValue([]),
  listConnectedAccounts: vi.fn().mockResolvedValue([]),
}));
const callPluginToolOnce = vi.fn();
vi.mock("./user-tools", () => ({
  listUserToolRows: vi.fn().mockResolvedValue([]),
  buildPluginServerUrl: () => "http://127.0.0.1:40000/atlassian-mcp/mcp",
  callPluginToolOnce: (...args: unknown[]) => callPluginToolOnce(...args),
}));
vi.mock("./billing/enforce", () => ({
  checkCallAllowance: vi.fn().mockResolvedValue({ allowed: true }),
}));
const resolveServiceToken = vi.fn();
vi.mock("./service-token", () => ({
  PLUGIN_SERVICE_MAP: { "atlassian-mcp": "atlassian", "gws-mcp": "google-workspace" },
  resolveServiceToken: (...args: unknown[]) => resolveServiceToken(...args),
}));

import { createMcpServer } from "./mcp-server";
import type { ConnectionPool } from "./pool";

const selectLimit = vi.fn();
const dbMock = {
  select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }),
} as unknown as Database;
const poolMock = { acquire: vi.fn(), release: vi.fn() } as unknown as ConnectionPool;

const SERVER_ROW = { id: "srv-2", slug: "atlassian-mcp", containerPort: 40001, githubRepoUrl: null };
const COMMENT_SCHEMA = {
  type: "object",
  properties: {
    issue_key: { type: "string" },
    comment: { type: "string" },
  },
  required: ["issue_key", "comment"],
};

async function connectedClient() {
  const server = createMcpServer("user-1", dbMock, poolMock, { baseUrl: "https://gw.example.test" });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

const text = (result: unknown): string =>
  ((result as { content: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join(" ");

beforeEach(() => {
  vi.clearAllMocks();
  selectLimit.mockResolvedValueOnce([SERVER_ROW]).mockResolvedValueOnce([{ schema: COMMENT_SCHEMA }]);
  resolveServiceToken.mockResolvedValue({ token: "token-fixture", accountEmail: "jira@example.com", scopes: null });
  callPluginToolOnce.mockResolvedValue({ content: [{ type: "text", text: "plugin answered" }] });
});

describe("a call the tool cannot take is refused before any plugin is reached", () => {
  it("names a missing required argument, and the plugin is never called", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "atlassian-mcp__jira_add_comment",
      arguments: { issue_key: "FIX-1" },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("missing required argument");
    expect(text(result)).toContain("comment");
    expect(callPluginToolOnce).not.toHaveBeenCalled();
    expect(resolveServiceToken).not.toHaveBeenCalled();
  });

  it("names an unknown argument, and the plugin is never called", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "atlassian-mcp__jira_add_comment",
      arguments: { issue_key: "FIX-1", body: "hello" },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('unknown argument "body"');
    expect(text(result)).toContain("missing required argument");
    expect(callPluginToolOnce).not.toHaveBeenCalled();
  });

  it("is tracked as a user error, never thrown", async () => {
    const client = await connectedClient();
    await client.callTool({ name: "atlassian-mcp__jira_add_comment", arguments: {} });
    expect(trackToolCall).toHaveBeenCalledTimes(1);
    const event = trackToolCall.mock.calls[0][1] as {
      toolName: string;
      outcome: { thrown: boolean; isError: boolean; errorMessage?: string };
    };
    expect(event.toolName).toBe("atlassian-mcp__jira_add_comment");
    expect(event.outcome.thrown).toBe(false);
    expect(event.outcome.isError).toBe(true);
    expect(event.outcome.errorMessage).toContain("missing required argument");
  });
});

describe("calls the tool can take are untouched", () => {
  it("passes a valid call through to the plugin, with the injected account allowed", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "atlassian-mcp__jira_add_comment",
      arguments: { issue_key: "FIX-1", comment: "hello", account: "jira@example.com" },
    });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toBe("plugin answered");
    expect(callPluginToolOnce).toHaveBeenCalledTimes(1);
    const sent = callPluginToolOnce.mock.calls[0][0] as { args: Record<string, unknown> };
    // The account was consumed by token resolution, as on any call.
    expect(sent.args).toEqual({ issue_key: "FIX-1", comment: "hello" });
  });

  it("does not refuse a tool with no registry row: that is today's behaviour, kept", async () => {
    selectLimit.mockReset();
    selectLimit.mockResolvedValueOnce([SERVER_ROW]).mockResolvedValueOnce([]);
    const client = await connectedClient();
    const result = await client.callTool({
      name: "atlassian-mcp__jira_add_comment",
      arguments: { anything: "goes" },
    });
    expect(result.isError).toBeFalsy();
    expect(callPluginToolOnce).toHaveBeenCalledTimes(1);
  });
});
