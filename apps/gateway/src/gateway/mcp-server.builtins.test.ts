/**
 * Built-in tools emit tool_call (SCRUM-66 / f-050).
 *
 * The defect was an OMISSION: echo and list_connected_accounts answered on
 * the wire and emitted nothing, and nothing alarmed because the silence was
 * undocumented. These tests iterate BUILT_IN_TOOLS rather than naming the two
 * tools, so a third built-in added to the registry is covered by construction
 * — which is the property the fix exists to create.
 *
 * Driven through a real MCP client/server pair over InMemoryTransport, not by
 * poking handlers directly: what is asserted is what a connected client's
 * call actually produces.
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
const listConnectedAccounts = vi.fn();
vi.mock("./connected-accounts", () => ({
  listConnectedAccounts: (...args: unknown[]) => listConnectedAccounts(...args),
}));
const listUserToolRows = vi.fn();
vi.mock("./user-tools", () => ({
  listUserToolRows: (...args: unknown[]) => listUserToolRows(...args),
  buildPluginServerUrl: () => "http://127.0.0.1:40000/mcp",
  callPluginToolOnce: vi.fn(),
}));

// Not the subject here — the allowance gate has its own suite
// (mcp-server.cap.test.ts); an open gate keeps these tests about metering.
vi.mock("./billing/enforce", () => ({
  checkCallAllowance: vi.fn().mockResolvedValue({ allowed: true }),
}));

import { createMcpServer, BUILT_IN_TOOLS } from "./mcp-server";
import type { ConnectionPool } from "./pool";

const selectLimit = vi.fn();
const dbMock = {
  select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }),
} as unknown as Database;

const poolCallTool = vi.fn();
const poolMock = {
  acquire: vi.fn().mockResolvedValue({ callTool: poolCallTool }),
  release: vi.fn(),
} as unknown as ConnectionPool;

async function connectedClient() {
  const server = createMcpServer("user-1", dbMock, poolMock);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  listUserToolRows.mockResolvedValue([]);
  listConnectedAccounts.mockResolvedValue([]);
  poolMock.acquire = vi.fn().mockResolvedValue({ callTool: poolCallTool });
});

describe("built-in tools", () => {
  it("the registry is not empty and still carries the two originals", () => {
    // Guards the tests below against becoming vacuous: iterating an empty
    // registry would assert nothing and stay green.
    const names = BUILT_IN_TOOLS.map((t) => t.definition.name);
    expect(names).toContain("echo");
    expect(names).toContain("list_connected_accounts");
  });

  it("every registry entry is served in tools/list", async () => {
    const client = await connectedClient();
    const listed = (await client.listTools()).tools.map((t) => t.name);
    for (const t of BUILT_IN_TOOLS) {
      expect(listed).toContain(t.definition.name);
    }
  });

  it("every built-in call emits tool_call — builtin, unmetered surface props intact", async () => {
    const client = await connectedClient();
    for (const t of BUILT_IN_TOOLS) {
      trackToolCall.mockClear();
      const result = await client.callTool({
        name: t.definition.name,
        arguments: { message: "smoke" },
      });
      expect(result.isError ?? false).toBe(false);
      expect(trackToolCall).toHaveBeenCalledTimes(1);
      expect(trackToolCall).toHaveBeenCalledWith(
        dbMock,
        expect.objectContaining({
          userId: "user-1",
          toolName: t.definition.name,
          connectorType: null,
          errorMessage: null,
          latencyMs: expect.any(Number),
          responseSizeBytes: expect.any(Number),
          outcome: expect.objectContaining({
            thrown: false,
            isError: false,
            source: "mcp",
            builtin: true,
          }),
        })
      );
    }
  });

  it("a built-in that throws still emits, as thrown and still builtin", async () => {
    listConnectedAccounts.mockRejectedValue(new Error("db unreachable"));
    const client = await connectedClient();
    const result = await client.callTool({
      name: "list_connected_accounts",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(trackToolCall).toHaveBeenCalledWith(
      dbMock,
      expect.objectContaining({
        toolName: "list_connected_accounts",
        errorMessage: "db unreachable",
        outcome: expect.objectContaining({ thrown: true, builtin: true }),
      })
    );
  });

  it("plugin-tool calls do NOT carry builtin — the boundary pinned from the other side", async () => {
    // The mirror of the emit-but-unmetered assertions above, per the
    // pin-boundaries-in-both-directions rule: if every call became
    // builtin:true, nothing would meter and the tests above would stay green.
    // A slug outside PLUGIN_SERVICE_MAP with no repo URL routes through the
    // pooled path, which needs no token and no further DB shape.
    selectLimit.mockResolvedValue([
      {
        id: "srv-1",
        slug: "some-plugin",
        containerPort: 40000,
        githubRepoUrl: null,
      },
    ]);
    poolCallTool.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
    });
    const client = await connectedClient();
    const result = await client.callTool({
      name: "some-plugin__do_thing",
      arguments: {},
    });
    expect(result.isError ?? false).toBe(false);
    expect(trackToolCall).toHaveBeenCalledTimes(1);
    const outcome = trackToolCall.mock.calls[0][1].outcome;
    expect(outcome.source).toBe("mcp");
    expect(outcome.builtin).toBeUndefined();
  });
});
