/**
 * SCRUM-384 at the dispatch: a tool that takes a file reference goes through
 * the crossing instead of the ordinary plugin call, and is still one tool
 * call, tracked once. Every other tool is untouched.
 *
 * Driven through a real client/server pair over InMemoryTransport, like
 * mcp-server.scope.test.ts, whose harness this mirrors. The crossing itself
 * is pinned in file-crossing.test.ts; here it is a stub.
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
  trackMcpToolsListed: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./connected-accounts", () => ({
  listConnectedAccounts: vi.fn().mockResolvedValue([]),
  accountsGrantingScope: vi.fn().mockResolvedValue([]),
}));
const callPluginToolOnce = vi.fn();
vi.mock("./user-tools", () => ({
  listUserToolRows: vi.fn().mockResolvedValue([]),
  buildPluginServerUrl: (row: { slug: string }) => `http://127.0.0.1:40000/${row.slug}/mcp`,
  callPluginToolOnce: (...args: unknown[]) => callPluginToolOnce(...args),
}));
vi.mock("./billing/enforce", () => ({
  checkCallAllowance: vi.fn().mockResolvedValue({ allowed: true }),
}));
const resolveServiceToken = vi.fn();
vi.mock("./service-token", () => ({
  PLUGIN_SERVICE_MAP: { "gws-mcp": "google-workspace", "atlassian-mcp": "atlassian" },
  resolveServiceToken: (...args: unknown[]) => resolveServiceToken(...args),
}));
const crossFile = vi.fn();
vi.mock("./file-crossing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./file-crossing")>()),
  crossFile: (...args: unknown[]) => crossFile(...args),
}));

import { createMcpServer } from "./mcp-server";
import type { ConnectionPool } from "./pool";
import type { CrossFileOptions } from "./file-crossing";

const selectLimit = vi.fn();
const dbMock = {
  select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }),
} as unknown as Database;

const poolMock = { acquire: vi.fn(), release: vi.fn() } as unknown as ConnectionPool;

async function connectedClient() {
  const server = createMcpServer("user-1", dbMock, poolMock, { baseUrl: "https://gw.example.test" });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

const RECEIPT = { content: [{ type: "text", text: "Attached (fixture receipt)" }], isError: false };
const FILE = { type: "gmail_message", message_id: "msg-fixture-1", account: "mail@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
  selectLimit.mockResolvedValue([
    { id: "srv-2", slug: "atlassian-mcp", containerPort: 40001, githubRepoUrl: null },
  ]);
  resolveServiceToken.mockResolvedValue({
    token: "destination-token-fixture",
    accountEmail: "jira@example.com",
    scopes: null,
  });
  crossFile.mockResolvedValue(RECEIPT);
  callPluginToolOnce.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
});

describe("a tool that takes a file", () => {
  it("goes through the crossing, not the plugin call, with the destination's own token", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "atlassian-mcp__jira_add_attachment",
      arguments: { issue_key: "FIX-1", file: FILE, account: "jira@example.com" },
    });

    expect(result).toMatchObject(RECEIPT);
    expect(callPluginToolOnce).not.toHaveBeenCalled();
    expect(poolMock.acquire).not.toHaveBeenCalled();
    expect(crossFile).toHaveBeenCalledTimes(1);
    const opts = crossFile.mock.calls[0][0] as CrossFileOptions;
    expect(opts).toMatchObject({
      userId: "user-1",
      tool: "atlassian-mcp__jira_add_attachment",
      toolName: "jira_add_attachment",
      destinationUrl: "http://127.0.0.1:40000/atlassian-mcp/mcp",
      destinationToken: "destination-token-fixture",
      surface: "mcp",
      connectionsUrl: "https://gw.example.test/dashboard/connections",
    });
    // The destination account was consumed by token resolution, as on any
    // call; the reference keeps its own.
    expect(opts.args).toEqual({ issue_key: "FIX-1", file: FILE });
    // The destination token was resolved for the destination's service and
    // the caller's account argument.
    expect(resolveServiceToken).toHaveBeenCalledTimes(1);
    expect(resolveServiceToken).toHaveBeenCalledWith(dbMock, "user-1", "atlassian", "jira@example.com");
  });

  it("resolves the source token for the session user only", async () => {
    const client = await connectedClient();
    await client.callTool({
      name: "atlassian-mcp__jira_add_attachment",
      arguments: { issue_key: "FIX-1", file: FILE },
    });
    const opts = crossFile.mock.calls[0][0] as CrossFileOptions;
    resolveServiceToken.mockClear();
    await opts.resolveToken("google-workspace", "mail@example.com");
    expect(resolveServiceToken).toHaveBeenCalledWith(dbMock, "user-1", "google-workspace", "mail@example.com");
  });

  it("finds the source plugin's address in the registry", async () => {
    const client = await connectedClient();
    await client.callTool({
      name: "atlassian-mcp__jira_add_attachment",
      arguments: { issue_key: "FIX-1", file: FILE },
    });
    const opts = crossFile.mock.calls[0][0] as CrossFileOptions;
    selectLimit.mockResolvedValueOnce([{ slug: "gws-mcp", containerPort: 40002, githubRepoUrl: null }]);
    expect(await opts.resolvePluginUrl("gws-mcp")).toBe("http://127.0.0.1:40000/gws-mcp/mcp");
    selectLimit.mockResolvedValueOnce([]);
    expect(await opts.resolvePluginUrl("gws-mcp")).toBeNull();
  });

  it("is one tool call, tracked once, under the destination's service and account", async () => {
    const client = await connectedClient();
    await client.callTool({
      name: "atlassian-mcp__jira_add_attachment",
      arguments: { issue_key: "FIX-1", file: FILE },
    });
    expect(trackToolCall).toHaveBeenCalledTimes(1);
    const [, props] = trackToolCall.mock.calls[0];
    expect(props).toMatchObject({
      toolName: "atlassian-mcp__jira_add_attachment",
      connectorType: "atlassian",
      accountEmail: "jira@example.com",
      errorMessage: null,
      outcome: { thrown: false, isError: false },
    });
    // Nothing about the file rides on the event.
    expect(JSON.stringify(props)).not.toContain("msg-fixture-1");
    expect(JSON.stringify(props)).not.toContain("mail@example.com");
  });

  it("tracks a refusal from the crossing as the same single call, as an error", async () => {
    crossFile.mockResolvedValue({
      content: [{ type: "text", text: "A file transfer of yours is already in progress." }],
      isError: true,
    });
    const client = await connectedClient();
    const result = await client.callTool({
      name: "atlassian-mcp__jira_add_attachment",
      arguments: { issue_key: "FIX-1", file: FILE },
    });
    expect(result.isError).toBe(true);
    expect(trackToolCall).toHaveBeenCalledTimes(1);
    expect(trackToolCall.mock.calls[0][1].outcome).toMatchObject({ thrown: false, isError: true });
  });

  it("shapes a throw from the crossing like any plugin failure", async () => {
    crossFile.mockRejectedValue(new Error("the file's source could not be reached. Nothing was uploaded."));
    const client = await connectedClient();
    const result = await client.callTool({
      name: "atlassian-mcp__jira_add_attachment",
      arguments: { issue_key: "FIX-1", file: FILE },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("Nothing was uploaded");
    expect(trackToolCall).toHaveBeenCalledTimes(1);
    expect(trackToolCall.mock.calls[0][1].outcome).toMatchObject({ thrown: true });
  });

  it("is never reached when the destination is not connected", async () => {
    resolveServiceToken.mockResolvedValue(null);
    const client = await connectedClient();
    const result = await client.callTool({
      name: "atlassian-mcp__jira_add_attachment",
      arguments: { issue_key: "FIX-1", file: FILE },
    });
    expect(result.isError).toBe(true);
    expect(crossFile).not.toHaveBeenCalled();
  });
});

describe("every other tool", () => {
  it("takes the ordinary plugin call, even with an argument that looks like a reference", async () => {
    const client = await connectedClient();
    await client.callTool({
      name: "atlassian-mcp__jira_add_comment",
      arguments: { issue_key: "FIX-1", body: "hello", file: FILE },
    });
    expect(crossFile).not.toHaveBeenCalled();
    expect(callPluginToolOnce).toHaveBeenCalledTimes(1);
    expect(callPluginToolOnce.mock.calls[0][0]).toMatchObject({
      toolName: "jira_add_comment",
      args: { issue_key: "FIX-1", body: "hello", file: FILE },
    });
    expect(trackToolCall).toHaveBeenCalledTimes(1);
  });
});
