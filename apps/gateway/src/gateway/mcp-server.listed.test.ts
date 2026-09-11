/**
 * tools/list says who asked (SCRUM-256).
 *
 * The event used to carry a bare count. A count cannot say which client
 * listed, over which protocol revision, or how much of the list was the
 * user's connectors versus the gateway's own built-ins, and those are the
 * questions a support thread about "my client shows no tools" actually asks.
 *
 * Driven through a real MCP client/server pair over InMemoryTransport, so
 * the client name and version asserted are the ones the handshake carried,
 * not values poked into the handler.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Database } from "@datatorag-mcp/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

vi.mock("./track", () => ({
  trackToolCall: vi.fn().mockResolvedValue(undefined),
  trackSkillSearched: vi.fn().mockResolvedValue(undefined),
  trackSkillApplied: vi.fn().mockResolvedValue(undefined),
}));
const trackMcpToolsListed = vi.fn().mockResolvedValue(undefined);
vi.mock("./mcp-analytics", () => ({
  trackMcpToolsListed: (...args: unknown[]) => trackMcpToolsListed(...args),
}));
vi.mock("./connected-accounts", () => ({
  listConnectedAccounts: vi.fn().mockResolvedValue([]),
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

import { createMcpServer, BUILT_IN_TOOLS } from "./mcp-server";
import type { ConnectionPool } from "./pool";

const dbMock = {
  select: () => ({ from: () => ({ where: () => ({ limit: vi.fn().mockResolvedValue([]) }) }) }),
} as unknown as Database;
const poolMock = { acquire: vi.fn(), release: vi.fn() } as unknown as ConnectionPool;

const ROWS = [
  {
    namespacedName: "gws-mcp__gmail_search",
    name: "gmail_search",
    description: "read",
    schema: { type: "object", properties: {} },
    requiredService: "google-workspace",
  },
  {
    namespacedName: "gws-mcp__gmail_send",
    name: "gmail_send",
    description: "write",
    schema: { type: "object", properties: {} },
    requiredService: "google-workspace",
  },
];

async function listWith(opts?: Parameters<typeof createMcpServer>[3], client?: Client) {
  const server = createMcpServer("user-1", dbMock, poolMock, opts);
  const c = client ?? new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await c.connect(clientTransport);
  return c.listTools();
}

beforeEach(() => {
  trackMcpToolsListed.mockClear();
  listUserToolRows.mockResolvedValue(ROWS);
});

describe("tools/list says who asked (SCRUM-256)", () => {
  it("splits the count into connector tools and built-ins", async () => {
    const { tools } = await listWith();
    expect(tools).toHaveLength(ROWS.length + BUILT_IN_TOOLS.length);
    expect(trackMcpToolsListed).toHaveBeenCalledTimes(1);
    const listed = trackMcpToolsListed.mock.calls[0]![2] as Record<string, unknown>;
    expect(listed).toMatchObject({ connectorTools: ROWS.length, builtinTools: BUILT_IN_TOOLS.length });
  });

  it("names the client the handshake carried and the protocol version the server was told", async () => {
    await listWith(
      { protocolVersion: "2025-06-18" },
      new Client({ name: "Claude Desktop", version: "1.4.0" })
    );
    const listed = trackMcpToolsListed.mock.calls[0]![2] as Record<string, unknown>;
    expect(listed).toMatchObject({
      clientName: "Claude Desktop",
      clientVersion: "1.4.0",
      protocolVersion: "2025-06-18",
    });
  });

  it("leaves the protocol version out when the server was not told one", async () => {
    await listWith();
    const listed = trackMcpToolsListed.mock.calls[0]![2] as Record<string, unknown>;
    expect(listed.protocolVersion).toBeUndefined();
    expect(listed.clientName).toBe("test-client");
  });

  it("counts a user with nothing connected as zero connector tools, not zero tools", async () => {
    listUserToolRows.mockResolvedValue([]);
    await listWith();
    const listed = trackMcpToolsListed.mock.calls[0]![2] as Record<string, unknown>;
    expect(listed).toMatchObject({ connectorTools: 0, builtinTools: BUILT_IN_TOOLS.length });
  });
});
