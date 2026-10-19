/**
 * tools/list serves each tool's readOnlyHint (SCRUM-326).
 *
 * Clients use readOnlyHint to decide what runs without asking. The listing
 * used to build each tool from name, description and input schema only, so
 * every read tool prompted like a write. The hint now comes from the same
 * registry row the description comes from (`tools.read_only_hint`), and a
 * row that recorded nothing serves nothing: absent, never a guessed false.
 * Built-ins take theirs from the `approval` they declare.
 *
 * This is a hint to the CLIENT. The agent's own write gate still judges by
 * name and never reads it; that is pinned in mastra/mcp/write-gate.test.ts.
 *
 * Driven through a real MCP client/server pair over InMemoryTransport, so
 * what is asserted is what crosses the protocol.
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
vi.mock("./mcp-analytics", () => ({
  trackMcpToolsListed: vi.fn().mockResolvedValue(undefined),
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
vi.mock("./admin", () => ({ isAdmin: vi.fn().mockResolvedValue(false) }));
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
    description: "Search messages.",
    schema: { type: "object", properties: {} },
    requiredService: "google-workspace",
    readOnlyHint: true,
  },
  {
    namespacedName: "gws-mcp__gmail_send",
    description: "Send a message.",
    schema: { type: "object", properties: {} },
    requiredService: "google-workspace",
    readOnlyHint: false,
  },
  {
    namespacedName: "legacy-mcp__unannotated",
    description: "A tool whose plugin declared nothing.",
    schema: { type: "object", properties: {} },
    requiredService: undefined,
    readOnlyHint: null,
  },
];

async function listTools() {
  const server = createMcpServer("user-1", dbMock, poolMock);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const { tools } = await client.listTools();
  return new Map(tools.map((t) => [t.name, t]));
}

beforeEach(() => {
  listUserToolRows.mockResolvedValue(ROWS);
});

describe("tools/list serves readOnlyHint from the registry row (SCRUM-326)", () => {
  it("serves readOnlyHint true for a tool whose row records read-only", async () => {
    const tools = await listTools();
    expect(tools.get("gws-mcp__gmail_search")?.annotations).toEqual({ readOnlyHint: true });
  });

  it("serves readOnlyHint false for a tool whose row records a write", async () => {
    const tools = await listTools();
    expect(tools.get("gws-mcp__gmail_send")?.annotations).toEqual({ readOnlyHint: false });
  });

  it("serves no readOnlyHint for a row that recorded none", async () => {
    const tools = await listTools();
    const tool = tools.get("legacy-mcp__unannotated");
    expect(tool).toBeDefined();
    expect(tool?.annotations?.readOnlyHint).toBeUndefined();
    expect(tool && "annotations" in tool).toBe(false);
  });

  it("serves each built-in the hint its declared approval implies", async () => {
    const tools = await listTools();
    const publicBuiltins = BUILT_IN_TOOLS.filter((t) => !t.audience);
    expect(publicBuiltins.some((t) => t.approval === "read")).toBe(true);
    expect(publicBuiltins.some((t) => t.approval === "write")).toBe(true);
    for (const entry of publicBuiltins) {
      expect(tools.get(entry.definition.name)?.annotations).toEqual({
        readOnlyHint: entry.approval === "read",
      });
    }
  });
});
