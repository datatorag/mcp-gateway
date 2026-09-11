/**
 * A key authenticates a tools/list and a tool call (SCRUM-245).
 *
 * The identity a key resolves to is handed to the same MCP server every
 * OAuth session gets, and the server is driven through a real client pair,
 * so what is asserted is what a connected machine client sees.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("./user-tools", () => ({
  listUserToolRows: vi.fn().mockResolvedValue([]),
  buildPluginServerUrl: () => "http://127.0.0.1:40000/mcp",
  callPluginToolOnce: vi.fn(),
}));
vi.mock("./billing/enforce", () => ({
  checkCallAllowance: vi.fn().mockResolvedValue({ allowed: true }),
}));

import { createMcpServer } from "./mcp-server";
import { resolveBearer, API_KEY_CLIENT_ID } from "./bearer-auth";
import type { ConnectionPool } from "./pool";

const selectResults: unknown[][] = [];
function chainable(result: unknown) {
  const p = Promise.resolve(result) as Promise<unknown> & Record<string, unknown>;
  for (const m of ["from", "where", "leftJoin", "orderBy", "limit"]) p[m] = () => p;
  return p;
}
const db = { select: () => chainable(selectResults.shift() ?? []) } as unknown as Database;
const poolMock = { acquire: vi.fn(), release: vi.fn() } as unknown as ConnectionPool;

beforeEach(() => {
  selectResults.length = 0;
  trackToolCall.mockClear();
});

describe("a key on /mcp (SCRUM-245)", () => {
  it("lists tools and calls one, and the call attributes to the key's client id", async () => {
    selectResults.push([{ id: "key-1", userId: "user-1", revokedAt: null, expiresAt: null }]);
    const auth = await resolveBearer(db, "sk-dtrmcp_abcdefghijklmnopqrstuvwxyz0123456789ABCDEF");
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;

    const server = createMcpServer(auth.userId, db, poolMock, { clientId: auth.clientId });
    const client = new Client({ name: "machine-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("echo");

    const result = await client.callTool({ name: "echo", arguments: { message: "hi" } });
    expect(JSON.stringify(result)).toContain("hi");
    expect(trackToolCall).toHaveBeenCalledTimes(1);
    const [, props] = trackToolCall.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(props.clientId).toBe(API_KEY_CLIENT_ID);
    expect(props.clientName).toBe("machine-client");
  });
});
