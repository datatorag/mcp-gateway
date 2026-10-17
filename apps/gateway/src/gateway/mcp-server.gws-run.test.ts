/**
 * SCRUM-419, part 3: a direct gws_run call from an account that is not on
 * the allowlist is refused at dispatch with a fixed message, before the
 * allowance gate, so it is never metered and never reaches the plugin. The
 * listing side is covered in user-tools.gws-run.test.ts.
 *
 * Driven through a real client/server pair over InMemoryTransport, like
 * mcp-server.scope.test.ts, whose harness this mirrors.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
  buildPluginServerUrl: () => "http://127.0.0.1:40000/mcp",
  callPluginToolOnce: (...args: unknown[]) => callPluginToolOnce(...args),
}));
const checkCallAllowance = vi.fn();
vi.mock("./billing/enforce", () => ({
  checkCallAllowance: (...args: unknown[]) => checkCallAllowance(...args),
}));
vi.mock("./service-token", () => ({
  PLUGIN_SERVICE_MAP: { "gws-mcp": "google-workspace" },
  resolveServiceToken: vi.fn().mockResolvedValue({
    token: "tok",
    accountEmail: "a@example.com",
    scopes: "openid https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.modify",
  }),
}));
const resolveUserEmail = vi.fn();
vi.mock("./user-email", () => ({
  resolveUserEmail: (...args: unknown[]) => resolveUserEmail(...args),
}));

import { createMcpServer } from "./mcp-server";
import type { ConnectionPool } from "./pool";

const selectLimit = vi.fn();
const dbMock = {
  select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }),
} as unknown as Database;
const poolMock = { acquire: vi.fn(), release: vi.fn() } as unknown as ConnectionPool;

async function connectedClient(surface?: "mcp" | "agent") {
  const server = createMcpServer("user-1", dbMock, poolMock, { surface });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

const REFUSAL =
  "gws_run is not available on this account; use the gmail_, calendar_, drive_, sheets_, docs_ or tasks_ tools.";
const RUN = {
  name: "gws-mcp__gws_run",
  arguments: { service: "calendar", resource: "events", method: "list", params: { calendarId: "primary" } },
};

function textOf(result: unknown): string {
  return ((result as { content: Array<{ text?: string }> }).content ?? []).map((c) => c.text).join(" ");
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GWS_RUN_ALLOWED_ACCOUNTS = "listed@example.com";
  selectLimit.mockResolvedValue([{ id: "srv-1", slug: "gws-mcp", containerPort: 40000, githubRepoUrl: null }]);
  checkCallAllowance.mockResolvedValue({ allowed: true });
  callPluginToolOnce.mockResolvedValue({ isError: false, content: [{ type: "text", text: "{}" }] });
});
afterEach(() => {
  delete process.env.GWS_RUN_ALLOWED_ACCOUNTS;
});

describe("gws_run at dispatch (SCRUM-419)", () => {
  it("an allowlisted account calls it and the plugin runs it", async () => {
    resolveUserEmail.mockResolvedValue("listed@example.com");
    const result = await (await connectedClient()).callTool(RUN);
    expect(result.isError).toBeFalsy();
    expect(callPluginToolOnce).toHaveBeenCalledTimes(1);
    expect(callPluginToolOnce.mock.calls[0][0].toolName).toBe("gws_run");
  });

  it("an account that is not listed is refused with the fixed message, unmetered, before the plugin", async () => {
    resolveUserEmail.mockResolvedValue("someone@example.com");
    const result = await (await connectedClient()).callTool(RUN);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(REFUSAL);
    expect(callPluginToolOnce).not.toHaveBeenCalled();
    expect(trackToolCall).not.toHaveBeenCalled();
    expect(checkCallAllowance).not.toHaveBeenCalled();
  });

  it("the agent's in-process server refuses it the same way", async () => {
    resolveUserEmail.mockResolvedValue("someone@example.com");
    const result = await (await connectedClient("agent")).callTool(RUN);
    expect(textOf(result)).toBe(REFUSAL);
    expect(callPluginToolOnce).not.toHaveBeenCalled();
  });

  it("an empty variable refuses everyone, listed email or not", async () => {
    process.env.GWS_RUN_ALLOWED_ACCOUNTS = "";
    resolveUserEmail.mockResolvedValue("listed@example.com");
    const result = await (await connectedClient()).callTool(RUN);
    expect(textOf(result)).toBe(REFUSAL);
    expect(callPluginToolOnce).not.toHaveBeenCalled();
  });

  it("every other tool is untouched for an account that is not listed", async () => {
    resolveUserEmail.mockResolvedValue("someone@example.com");
    const result = await (await connectedClient()).callTool({ name: "gws-mcp__gmail_search", arguments: { query: "x" } });
    expect(result.isError).toBeFalsy();
    expect(callPluginToolOnce).toHaveBeenCalledTimes(1);
    expect(resolveUserEmail).not.toHaveBeenCalled();
  });
});
