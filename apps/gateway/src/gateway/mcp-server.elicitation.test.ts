/**
 * SCRUM-466: URL elicitation never holds a tool call. A not-connected refusal
 * and `connect` answer at once with the link in the result; a client that
 * declared URL elicitation is also sent the same link as a prompt, which is
 * never awaited. Whatever the client does with the prompt, accept, decline
 * or nothing, the answer is the same, and nothing runs the call again. The
 * exact failure this exists for: a client showing a prompt nobody answers
 * held the call open until the edge cut it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@datatorag-mcp/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";

vi.mock("./track", () => ({
  trackConnectLinkEvent: vi.fn(async () => undefined),
  trackToolCall: vi.fn(async () => undefined),
}));
vi.mock("./mcp-analytics", () => ({ trackMcpToolsListed: vi.fn(async () => undefined) }));
const listConnectedAccounts = vi.fn();
vi.mock("./connected-accounts", () => ({
  listConnectedAccounts: (...a: unknown[]) => listConnectedAccounts(...a),
  accountsGrantingScope: vi.fn(async () => []),
}));
vi.mock("./service-launch", () => ({
  launchedServiceIds: vi.fn(async () => new Set(["google-workspace", "atlassian", "notion"])),
}));
const callPluginToolOnce = vi.fn();
vi.mock("./user-tools", () => ({
  listUserToolRows: vi.fn(async () => []),
  buildPluginServerUrl: () => "http://127.0.0.1:40000/mcp",
  callPluginToolOnce: (...a: unknown[]) => callPluginToolOnce(...a),
}));
vi.mock("./billing/enforce", () => ({ checkCallAllowance: vi.fn(async () => ({ allowed: true })) }));
vi.mock("./admin", () => ({ isAdmin: vi.fn(async () => false) }));
const resolveServiceToken = vi.fn();
vi.mock("./service-token", async () => ({
  PLUGIN_SERVICE_MAP: { "gws-mcp": "google-workspace" },
  resolveServiceToken: (...a: unknown[]) => resolveServiceToken(...a),
  ambiguousAccountMessage: (await vi.importActual<typeof import("./service-token")>("./service-token"))
    .ambiguousAccountMessage,
}));
vi.mock("./user-email", () => ({ resolveUserEmail: vi.fn(async () => "member@example.com") }));
let linkSeq = 0;
const issueConnectLink = vi.fn();
const markConnectLinkCompleted = vi.fn(async () => undefined);
vi.mock("./connect-links", async (orig) => ({
  ...(await orig<typeof import("./connect-links")>()),
  issueConnectLink: (...a: unknown[]) => issueConnectLink(...a),
  markConnectLinkCompleted: (...a: unknown[]) => markConnectLinkCompleted(...(a as [])),
}));

import { createMcpServer } from "./mcp-server";
import { connectLinkDone } from "./connect-elicitation";
import type { ConnectionPool } from "./pool";

const BASE = "https://gw.example";
const selectLimit = vi.fn();
const db = { select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }) } as unknown as Database;
const pool = { acquire: vi.fn(), release: vi.fn() } as unknown as ConnectionPool;

type Answer = "accept" | "decline" | "never";
type Asked = { mode?: string; url?: string; message: string; elicitationId?: string };

const clients: Client[] = [];

async function clientWith(elicitation: Record<string, unknown> | undefined, answer: Answer) {
  const asked: Asked[] = [];
  const completed: string[] = [];
  const client = new Client({ name: "claude-code", version: "2.1.316" }, { capabilities: elicitation ? { elicitation } : {} });
  // A client without the capability cannot even register the handler.
  if (elicitation) {
    client.setRequestHandler(ElicitRequestSchema, async (req) => {
      asked.push(req.params as Asked);
      if (answer === "never") return new Promise<never>(() => undefined);
      return { action: answer };
    });
  }
  client.fallbackNotificationHandler = async (n) => {
    if (n.method === "notifications/elicitation/complete") completed.push(String((n.params as { elicitationId?: unknown })?.elicitationId));
  };
  const server = createMcpServer("user-1", db, pool, { baseUrl: BASE });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);
  clients.push(client);
  return { client, asked, completed };
}

function textOf(result: unknown): string {
  return ((result as { content: Array<{ text?: string }> }).content ?? []).map((c) => c.text).join(" ");
}

beforeEach(() => {
  vi.clearAllMocks();
  linkSeq = 0;
  selectLimit.mockResolvedValue([{ id: "srv-1", slug: "gws-mcp", containerPort: 40000, githubRepoUrl: null }]);
  listConnectedAccounts.mockResolvedValue([]);
  resolveServiceToken.mockResolvedValue(null);
  issueConnectLink.mockImplementation(async (_db: unknown, input: { path: string }) => {
    linkSeq += 1;
    return { id: `link-${linkSeq}`, url: `${BASE}/connect/${input.path}-${linkSeq}` };
  });
  callPluginToolOnce.mockResolvedValue({ content: [{ type: "text", text: "3 files" }] });
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

describe("a client that declared URL elicitation", () => {
  it("gets the refusal at once, with the link, while a prompt it never answers is still open", async () => {
    const { client, asked } = await clientWith({ url: {} }, "never");
    const started = Date.now();
    const result = await client.callTool({ name: "gws-mcp__drive_search", arguments: { query: "q" } });
    // The exact failure: the call used to wait on this prompt.
    expect(Date.now() - started).toBeLessThan(2000);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ next: "connect", connect_url: `${BASE}/connect/elicitation-1` });
    expect(textOf(result)).toContain(`Connect it here: ${BASE}/connect/elicitation-1`);
    // The same link, once, as a prompt.
    expect(asked).toEqual([
      { mode: "url", elicitationId: expect.stringMatching(/^[0-9a-f-]{36}$/), url: `${BASE}/connect/elicitation-1`, message: "Connect Google Workspace to continue." },
    ]);
    expect(issueConnectLink).toHaveBeenCalledTimes(1);
  });

  it("gets the same answer whatever it does with the prompt, and the call never runs again", async () => {
    const answers: string[] = [];
    for (const answer of ["accept", "decline", "never"] as const) {
      linkSeq = 0;
      const { client } = await clientWith({ url: {} }, answer);
      const result = await client.callTool({ name: "gws-mcp__drive_search", arguments: { query: "q" } });
      answers.push(JSON.stringify(result));
    }
    expect(new Set(answers).size).toBe(1);
    expect(resolveServiceToken).toHaveBeenCalledTimes(3);
    expect(callPluginToolOnce).not.toHaveBeenCalled();
  });

  it("is told the prompt is done when the link's connect completes, and the link is marked", async () => {
    const { client, asked, completed } = await clientWith({ url: {} }, "never");
    await client.callTool({ name: "gws-mcp__drive_search", arguments: { query: "q" } });
    await connectLinkDone(db, "link-1");
    await vi.waitFor(() => expect(completed).toEqual([asked[0].elicitationId]));
    expect(markConnectLinkCompleted).toHaveBeenCalledWith(db, "link-1");
  });

  it("connect for a provider not connected answers at once and prompts for that one only", async () => {
    const { client, asked } = await clientWith({ url: {} }, "never");
    const started = Date.now();
    const result = await client.callTool({ name: "connect", arguments: {} });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(textOf(result)).toContain("Google Workspace: not connected. Connect it here:");
    expect(asked.map((a) => a.message)).toEqual(["Connect Google Workspace to continue."]);
  });

  it("connect with service for a provider that is connected sends no prompt, only the add-account link", async () => {
    listConnectedAccounts.mockResolvedValue([
      { connectorType: "notion", accountEmail: "a@example.com", label: "W", externalAccountId: "ws", isDefault: true, lastRefreshError: null, refreshPermanentFailures: 0 },
    ]);
    const { client, asked } = await clientWith({ url: {} }, "accept");
    const result = await client.callTool({ name: "connect", arguments: { service: "notion" } });
    expect(textOf(result)).toContain("Connect another account here: https://gw.example/connect/tool_result-1");
    expect(asked).toHaveLength(0);
  });
});

describe("a client that did not declare URL elicitation", () => {
  for (const [label, elicitation] of [["form only", {}], ["none", undefined]] as const) {
    it(`(${label}) is never asked, and gets the tool result with a link`, async () => {
      const { client, asked } = await clientWith(elicitation as Record<string, unknown> | undefined, "accept");
      const result = await client.callTool({ name: "gws-mcp__drive_search", arguments: { query: "q" } });
      expect(asked).toHaveLength(0);
      expect(result.structuredContent).toMatchObject({ connect_url: `${BASE}/connect/tool_result-1` });
    });
  }
});
