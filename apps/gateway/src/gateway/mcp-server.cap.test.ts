/**
 * The allowance gate STOPS a dispatch — not merely fires.
 *
 * Driven through a real MCP client/server pair over InMemoryTransport, like
 * the built-ins suite: what is asserted is what a connected client receives.
 * The property that matters is on the far side of the gate: when the
 * allowance refuses, NO dispatch path runs (no pool acquire, no one-shot
 * call) and nothing meters. A gate that returned an error while the call
 * still went out the back would pass a weaker test shape.
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
}));
const callPluginToolOnce = vi.fn();
const listUserToolRows = vi.fn().mockResolvedValue([]);
vi.mock("./user-tools", () => ({
  listUserToolRows: (...args: unknown[]) => listUserToolRows(...args),
  buildPluginServerUrl: () => "http://127.0.0.1:40000/mcp",
  callPluginToolOnce: (...args: unknown[]) => callPluginToolOnce(...args),
}));
const checkCallAllowance = vi.fn();
vi.mock("./billing/enforce", () => ({
  checkCallAllowance: (...args: unknown[]) => checkCallAllowance(...args),
}));

import { createMcpServer } from "./mcp-server";
import type { ConnectionPool } from "./pool";

const selectLimit = vi.fn();
const dbMock = {
  select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }),
} as unknown as Database;

const poolCallTool = vi.fn();
const poolAcquire = vi.fn();
const poolMock = {
  acquire: poolAcquire,
  release: vi.fn(),
} as unknown as ConnectionPool;

async function connectedClient() {
  const server = createMcpServer("user-1", dbMock, poolMock);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  listUserToolRows.mockResolvedValue([]);
  poolAcquire.mockResolvedValue({ callTool: poolCallTool });
  poolCallTool.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
  selectLimit.mockResolvedValue([
    { id: "srv-1", slug: "someplugin", containerPort: 40000, githubRepoUrl: null },
  ]);
  checkCallAllowance.mockResolvedValue({ allowed: true });
});

describe("call allowance gate in CallTool", () => {
  it("an over-cap user's plugin call is refused AND never dispatched or metered", async () => {
    checkCallAllowance.mockResolvedValue({
      allowed: false,
      message: "Monthly free-plan limit reached (250 tool calls).",
    });
    const client = await connectedClient();
    const result = await client.callTool({
      name: "someplugin__some_tool",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("limit reached");
    // The property that matters: the gate STOPPED the call.
    expect(poolAcquire).not.toHaveBeenCalled();
    expect(callPluginToolOnce).not.toHaveBeenCalled();
    expect(trackToolCall).not.toHaveBeenCalled();
  });

  it("an allowed call dispatches exactly as before", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "someplugin__some_tool",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    expect(poolAcquire).toHaveBeenCalledTimes(1);
    expect(checkCallAllowance).toHaveBeenCalledWith(dbMock, "user-1");
  });

  it("built-in tools still answer for a capped user — they are unmetered probes", async () => {
    checkCallAllowance.mockResolvedValue({ allowed: false, message: "capped" });
    const client = await connectedClient();
    const result = await client.callTool({
      name: "echo",
      arguments: { message: "still here" },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.stringify(result.content)).toContain("still here");
  });
});
