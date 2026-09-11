/**
 * A tool call carries the surface the server was built for (SCRUM-255).
 *
 * The in-process construction for the dashboard agent passes
 * `surface: "agent"`, and the event stamped `"mcp"` on every call anyway,
 * so a playground skill run and an external MCP client were one cohort in
 * the per-surface split. Driven through a real client/server pair over
 * InMemoryTransport, as the sibling suites are, plus one static guard: no
 * call site in the server may hard-code the surface again.
 */

import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Database } from "@datatorag-mcp/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const trackToolCall = vi.fn().mockResolvedValue(undefined);
vi.mock("./track", () => ({
  trackToolCall: (...args: unknown[]) => trackToolCall(...args),
  trackSkillSearched: vi.fn().mockResolvedValue(undefined),
  trackSkillApplied: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./mcp-analytics", () => ({
  trackMcpToolsListed: vi.fn().mockResolvedValue(undefined),
}));
const listConnectedAccounts = vi.fn();
vi.mock("./connected-accounts", () => ({
  listConnectedAccounts: (...args: unknown[]) => listConnectedAccounts(...args),
}));
vi.mock("./skills/catalogue-store", () => ({
  createUserSkill: vi.fn(),
  updateUserSkill: vi.fn(),
  forkSkill: vi.fn(),
  deleteUserSkill: vi.fn(),
}));
vi.mock("./connected-services", () => ({
  listConnectedServiceIds: vi.fn().mockResolvedValue(new Set<string>()),
}));
const listUserToolRows = vi.fn();
vi.mock("./user-tools", () => ({
  listUserToolRows: (...args: unknown[]) => listUserToolRows(...args),
  buildPluginServerUrl: () => "http://127.0.0.1:40000/mcp",
  callPluginToolOnce: vi.fn(),
}));
vi.mock("./billing/enforce", () => ({
  checkCallAllowance: vi.fn().mockResolvedValue({ allowed: true }),
}));

import { createMcpServer } from "./mcp-server";
import type { ConnectionPool } from "./pool";

const selectLimit = vi.fn();
const dbMock = {
  select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }),
} as unknown as Database;
const poolMock = {
  acquire: vi.fn().mockResolvedValue({ callTool: vi.fn() }),
  release: vi.fn(),
} as unknown as ConnectionPool;

async function connectedClient(surface?: "mcp" | "agent") {
  const server = createMcpServer("user-1", dbMock, poolMock, surface ? { surface } : undefined);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  listUserToolRows.mockResolvedValue([]);
  listConnectedAccounts.mockResolvedValue([]);
});

describe("tool_call carries the server's surface (SCRUM-255)", () => {
  it("a server built for the agent stamps agent on a built-in call", async () => {
    const client = await connectedClient("agent");
    await client.callTool({ name: "echo", arguments: { message: "smoke" } });
    expect(trackToolCall).toHaveBeenCalledTimes(1);
    expect(trackToolCall.mock.calls[0]![1]).toMatchObject({ outcome: expect.objectContaining({ source: "agent" }) });
  });

  it("a server built with no surface stamps mcp, the default for a real client", async () => {
    const client = await connectedClient();
    await client.callTool({ name: "echo", arguments: { message: "smoke" } });
    expect(trackToolCall.mock.calls[0]![1]).toMatchObject({ outcome: expect.objectContaining({ source: "mcp" }) });
  });

  it("a built-in that throws stamps the surface too", async () => {
    listConnectedAccounts.mockRejectedValue(new Error("db unreachable"));
    const client = await connectedClient("agent");
    await client.callTool({ name: "list_connected_accounts", arguments: {} });
    expect(trackToolCall.mock.calls[0]![1]).toMatchObject({ outcome: expect.objectContaining({ thrown: true, source: "agent" }) });
  });

  it("no call site in the server hard-codes the surface any more", () => {
    // The plugin call paths need a live plugin to drive, so this pins them
    // by reading the source: the only way a call can say mcp is the
    // `surface` the server was built with.
    const source = readFileSync(new URL("./mcp-server.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/source:\s*"mcp"/);
    expect(source).not.toMatch(/source:\s*"agent"/);
    expect((source.match(/source:\s*surface/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});
