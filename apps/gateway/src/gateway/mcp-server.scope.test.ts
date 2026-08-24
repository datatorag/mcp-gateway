/**
 * SCRUM-136 on the MCP surface: a missing-scope call is refused in words
 * BEFORE dispatch, and a Google insufficient-scope 403 that slips through is
 * rewritten on the way back. The users this exists for read tool errors
 * relayed by their own MCP client, so the text itself is the product surface.
 *
 * Driven through a real client/server pair over InMemoryTransport, like
 * mcp-server.builtins.test.ts, whose harness this mirrors.
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
const accountsGrantingScope = vi.fn();
vi.mock("./connected-accounts", () => ({
  listConnectedAccounts: vi.fn().mockResolvedValue([]),
  accountsGrantingScope: (...args: unknown[]) => accountsGrantingScope(...args),
}));
const callPluginToolOnce = vi.fn();
vi.mock("./user-tools", () => ({
  listUserToolRows: vi.fn().mockResolvedValue([]),
  buildPluginServerUrl: () => "http://127.0.0.1:40000/mcp",
  callPluginToolOnce: (...args: unknown[]) => callPluginToolOnce(...args),
}));
vi.mock("./billing/enforce", () => ({
  checkCallAllowance: vi.fn().mockResolvedValue({ allowed: true }),
}));
const resolveServiceToken = vi.fn();
vi.mock("./service-token", () => ({
  PLUGIN_SERVICE_MAP: { "gws-mcp": "google-workspace" },
  resolveServiceToken: (...args: unknown[]) => resolveServiceToken(...args),
}));

import { createMcpServer } from "./mcp-server";
import type { ConnectionPool } from "./pool";

const selectLimit = vi.fn();
const dbMock = {
  select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }),
} as unknown as Database;

const poolMock = {
  acquire: vi.fn(),
  release: vi.fn(),
} as unknown as ConnectionPool;

async function connectedClient(baseUrl?: string) {
  const server = createMcpServer("user-1", dbMock, poolMock, { baseUrl });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

const IDENTITY_ONLY =
  "https://www.googleapis.com/auth/userinfo.email openid";
const FULL_GRANT = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/contacts",
  "https://www.googleapis.com/auth/tasks",
].join(" ");

function textOf(result: unknown): string {
  return ((result as { content: Array<{ text?: string }> }).content ?? [])
    .map((c) => c.text)
    .join(" ");
}

beforeEach(() => {
  vi.clearAllMocks();
  // The gws-mcp server row the dispatch looks up by slug.
  selectLimit.mockResolvedValue([
    { id: "srv-1", slug: "gws-mcp", containerPort: 40000, githubRepoUrl: null },
  ]);
  // No alternate accounts unless a test says otherwise.
  accountsGrantingScope.mockResolvedValue([]);
});

describe("pre-call scope gate (SCRUM-107)", () => {
  it("refuses a call whose scope was never granted, before any dispatch", async () => {
    resolveServiceToken.mockResolvedValue({
      token: "tok",
      accountEmail: "a@example.com",
      scopes: IDENTITY_ONLY,
    });
    const client = await connectedClient("https://gw.example.test");

    const result = await client.callTool({
      name: "gws-mcp__drive_search",
      arguments: { query: "q" },
    });

    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("Drive access");
    expect(text).toContain("https://gw.example.test/dashboard/connections/google-workspace");
    expect(text).not.toContain("googleapis.com");
    // Refused BEFORE dispatch: the plugin was never spoken to.
    expect(callPluginToolOnce).not.toHaveBeenCalled();

    // And the refusal is metered with the distinct marker — a block the
    // instrumentation cannot see would be one-sided measurement.
    expect(trackToolCall).toHaveBeenCalledTimes(1);
    const [, props] = trackToolCall.mock.calls[0];
    expect(props.errorMessage).toContain("[missing-scope]");
    expect(props.errorMessage).toContain("Drive");
  });

  it("names the judged account and the alternate that CAN serve (SCRUM-145)", async () => {
    resolveServiceToken.mockResolvedValue({
      token: "tok",
      accountEmail: "narrow@example.com",
      scopes: IDENTITY_ONLY,
    });
    accountsGrantingScope.mockResolvedValue(["granted@example.com"]);
    const client = await connectedClient("https://gw.example.test");

    const result = await client.callTool({
      name: "gws-mcp__gmail_search",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const text = textOf(result);
    // "Gmail not granted" alone is misleading to a user who just granted
    // Gmail on another account — the refusal must say which account it
    // used and which one would work.
    expect(text).toContain("narrow@example.com");
    expect(text).toContain("granted@example.com");
    expect(text).toContain("https://gw.example.test/dashboard/connections/google-workspace");
    // The lookup excluded the account the call ran as.
    expect(accountsGrantingScope).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "google-workspace",
      "https://www.googleapis.com/auth/gmail.modify",
      "narrow@example.com"
    );
    expect(callPluginToolOnce).not.toHaveBeenCalled();
  });

  it("still refuses in words when the alternate lookup itself fails", async () => {
    resolveServiceToken.mockResolvedValue({
      token: "tok",
      accountEmail: "narrow@example.com",
      scopes: IDENTITY_ONLY,
    });
    accountsGrantingScope.mockRejectedValue(new Error("db down"));
    const client = await connectedClient("https://gw.example.test");

    const result = await client.callTool({
      name: "gws-mcp__gmail_search",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    // Enrichment failure falls back to the plain refusal, never a crash.
    expect(textOf(result)).toContain("Gmail access");
    expect(callPluginToolOnce).not.toHaveBeenCalled();
  });

  it("dispatches normally when the scope IS granted", async () => {
    resolveServiceToken.mockResolvedValue({
      token: "tok",
      accountEmail: "a@example.com",
      scopes: FULL_GRANT,
    });
    callPluginToolOnce.mockResolvedValue({
      content: [{ type: "text", text: "3 files found" }],
    });
    const client = await connectedClient();

    const result = await client.callTool({
      name: "gws-mcp__drive_search",
      arguments: { query: "q" },
    });

    expect(result.isError ?? false).toBe(false);
    expect(callPluginToolOnce).toHaveBeenCalledTimes(1);
    expect(textOf(result)).toBe("3 files found");
  });

  it("fails open for legacy rows with no stored scopes", async () => {
    resolveServiceToken.mockResolvedValue({
      token: "tok",
      accountEmail: null,
      scopes: null,
    });
    callPluginToolOnce.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
    });
    const client = await connectedClient();

    const result = await client.callTool({
      name: "gws-mcp__gmail_search",
      arguments: {},
    });

    expect(result.isError ?? false).toBe(false);
    expect(callPluginToolOnce).toHaveBeenCalledTimes(1);
  });
});

describe("the 403 rewrite (the net behind the gate)", () => {
  it("replaces a Google insufficient-scope error with the worded message, metering the raw one", async () => {
    // A stale row: scopes claim the grant is fine, Google disagrees.
    resolveServiceToken.mockResolvedValue({
      token: "tok",
      accountEmail: "a@example.com",
      scopes: FULL_GRANT,
    });
    callPluginToolOnce.mockResolvedValue({
      isError: true,
      content: [
        {
          type: "text",
          text: "Request had insufficient authentication scopes.",
        },
      ],
    });
    const client = await connectedClient("https://gw.example.test");

    const result = await client.callTool({
      name: "gws-mcp__gmail_search",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("Gmail access");
    expect(text).toContain("https://gw.example.test/dashboard/connections/google-workspace");
    expect(text).not.toContain("insufficient authentication scopes");

    // The usage row keeps the truth: the RAW error, not the words.
    const [, props] = trackToolCall.mock.calls[0];
    expect(props.errorMessage).toContain("insufficient authentication scopes");
  });

  it("leaves non-scope errors untouched — the rewrite can stay silent", async () => {
    resolveServiceToken.mockResolvedValue({
      token: "tok",
      accountEmail: "a@example.com",
      scopes: FULL_GRANT,
    });
    callPluginToolOnce.mockResolvedValue({
      isError: true,
      content: [{ type: "text", text: "rate limit exceeded" }],
    });
    const client = await connectedClient();

    const result = await client.callTool({
      name: "gws-mcp__gmail_search",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("rate limit exceeded");
  });
});
