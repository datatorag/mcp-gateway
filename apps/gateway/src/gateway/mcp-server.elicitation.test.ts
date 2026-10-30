/**
 * SCRUM-466: URL-mode elicitation on a not-connected refusal, through a real
 * client/server pair. What must hold: a client that declared URL mode is
 * asked to open a connect link; on accept the call waits for that link's
 * connect and then runs once more, as it was asked, and that answer is the
 * call's; a second refusal is returned, never asked again; decline, and an
 * accept that never completes, end in the tool result with a fresh link; a
 * client with `elicitation: {}` (form only) is never asked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@datatorag-mcp/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";

vi.mock("./track", () => ({
  trackConnectLinkEvent: vi.fn(async () => undefined), trackToolCall: vi.fn(async () => undefined) }));
vi.mock("./mcp-analytics", () => ({ trackMcpToolsListed: vi.fn(async () => undefined) }));
vi.mock("./connected-accounts", () => ({
  listConnectedAccounts: vi.fn(async () => []),
  accountsGrantingScope: vi.fn(async () => []),
}));
const callPluginToolOnce = vi.fn();
vi.mock("./user-tools", () => ({
  listUserToolRows: vi.fn(async () => []),
  buildPluginServerUrl: () => "http://127.0.0.1:40000/mcp",
  callPluginToolOnce: (...a: unknown[]) => callPluginToolOnce(...a),
}));
vi.mock("./billing/enforce", () => ({ checkCallAllowance: vi.fn(async () => ({ allowed: true })) }));
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
const connectLinkCompleted = vi.fn(async () => false);
vi.mock("./connect-links", async (orig) => ({
  ...(await orig<typeof import("./connect-links")>()),
  issueConnectLink: (...a: unknown[]) => issueConnectLink(...a),
  connectLinkCompleted: (...a: unknown[]) => connectLinkCompleted(...(a as [])),
  markConnectLinkCompleted: vi.fn(async () => undefined),
}));

import { createMcpServer } from "./mcp-server";
import { CONNECT_WAIT_MS, connectLinkDone } from "./connect-elicitation";
import type { ConnectionPool } from "./pool";

const BASE = "https://gw.example";
const selectLimit = vi.fn();
const db = { select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }) } as unknown as Database;
const pool = { acquire: vi.fn(), release: vi.fn() } as unknown as ConnectionPool;

type Answer = "accept-and-connect" | "accept" | "decline";

async function clientWith(elicitation: Record<string, unknown> | undefined, answer: Answer) {
  const asked: Array<{ mode?: string; url?: string; message: string; elicitationId?: string }> = [];
  const client = new Client({ name: "claude-code", version: "2.1.300" }, { capabilities: elicitation ? { elicitation } : {} });
  // A client without the capability cannot even register the handler.
  if (elicitation) client.setRequestHandler(ElicitRequestSchema, async (req) => {
    const p = req.params as { mode?: string; url?: string; message: string; elicitationId?: string };
    asked.push(p);
    if (answer === "decline") return { action: "decline" };
    // The user opens the link and finishes the provider's consent screen.
    if (answer === "accept-and-connect") setTimeout(() => void connectLinkDone(db, `link-${linkSeq}`), 10);
    return { action: "accept" };
  });
  const server = createMcpServer("user-1", db, pool, { baseUrl: BASE });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);
  return { client, asked };
}

function textOf(result: unknown): string {
  return ((result as { content: Array<{ text?: string }> }).content ?? []).map((c) => c.text).join(" ");
}

beforeEach(() => {
  vi.clearAllMocks();
  linkSeq = 0;
  selectLimit.mockResolvedValue([{ id: "srv-1", slug: "gws-mcp", containerPort: 40000, githubRepoUrl: null }]);
  issueConnectLink.mockImplementation(async (_db: unknown, input: { path: string }) => {
    linkSeq += 1;
    return { id: `link-${linkSeq}`, url: `${BASE}/connect/${input.path}-${linkSeq}` };
  });
  callPluginToolOnce.mockResolvedValue({ content: [{ type: "text", text: "3 files" }] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a client that declared URL elicitation", () => {
  it("is asked to open the link, and on a completed connect the call runs again as asked", async () => {
    resolveServiceToken
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ token: "tok", accountEmail: "work@example.com", scopes: null });
    const { client, asked } = await clientWith({ url: {} }, "accept-and-connect");

    const result = await client.callTool({ name: "gws-mcp__drive_search", arguments: { query: "q", account: "work@example.com" } });

    expect(asked).toEqual([
      { mode: "url", elicitationId: expect.stringMatching(/^[0-9a-f-]{36}$/), url: `${BASE}/connect/elicitation-1`, message: "Connect Google Workspace to continue." },
    ]);
    // Its own random id: the link's row id is never sent out.
    expect(asked[0].elicitationId).not.toBe("link-1");
    expect(textOf(result)).toBe("3 files");
    expect(result.isError).toBeFalsy();
    // The re-run asked for the same account the call named.
    expect(resolveServiceToken).toHaveBeenLastCalledWith(expect.anything(), "user-1", "google-workspace", "work@example.com");
    expect(callPluginToolOnce).toHaveBeenCalledTimes(1);
  });

  it("returns a second refusal as it is, and never asks again", async () => {
    resolveServiceToken.mockResolvedValue(null);
    const { client, asked } = await clientWith({ url: {} }, "accept-and-connect");
    const result = await client.callTool({ name: "gws-mcp__drive_search", arguments: { query: "q" } });
    expect(asked).toHaveLength(1);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ next: "connect", connect_url: `${BASE}/connect/tool_result-2` });
  });

  it("on decline, answers with the tool result and a fresh link", async () => {
    resolveServiceToken.mockResolvedValue(null);
    const { client, asked } = await clientWith({ url: {} }, "decline");
    const result = await client.callTool({ name: "gws-mcp__drive_search", arguments: { query: "q" } });
    expect(asked).toHaveLength(1);
    expect(textOf(result)).toContain(`Connect it here: ${BASE}/connect/tool_result-2`);
    expect(callPluginToolOnce).not.toHaveBeenCalled();
  });

  it("an accept that never completes ends at the wait, with a fresh link, never hanging", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    resolveServiceToken.mockResolvedValue(null);
    const { client } = await clientWith({ url: {} }, "accept");
    // A client that waits as long as the call may take; one that gives up
    // sooner sees its own timeout instead.
    const pending = client.callTool({ name: "gws-mcp__drive_search", arguments: { query: "q" } }, undefined, { timeout: 15 * 60_000 });
    await vi.advanceTimersByTimeAsync(CONNECT_WAIT_MS + 1000);
    const result = await pending;
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ connect_url: `${BASE}/connect/tool_result-2` });
    expect(connectLinkCompleted).toHaveBeenCalled();
  });

  it("a connect seen only in the database, from another process, ends the wait too", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    resolveServiceToken
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ token: "tok", accountEmail: "a@example.com", scopes: null });
    connectLinkCompleted.mockResolvedValue(true);
    const { client } = await clientWith({ url: {} }, "accept");
    // A client that waits as long as the call may take; one that gives up
    // sooner sees its own timeout instead.
    const pending = client.callTool({ name: "gws-mcp__drive_search", arguments: { query: "q" } }, undefined, { timeout: 15 * 60_000 });
    await vi.advanceTimersByTimeAsync(6_000);
    expect(textOf(await pending)).toBe("3 files");
  });

  it("the connect tool asks for the first provider not connected, then reports it", async () => {
    const { client, asked } = await clientWith({ url: {} }, "decline");
    await client.callTool({ name: "connect", arguments: {} });
    expect(asked.map((a) => a.message)).toEqual(["Connect Google Workspace to continue."]);
  });
});

describe("a client that did not declare URL elicitation", () => {
  for (const [label, elicitation] of [["form only", {}], ["none", undefined]] as const) {
    it(`(${label}) is never asked, and gets the tool result with a link`, async () => {
      resolveServiceToken.mockResolvedValue(null);
      const { client, asked } = await clientWith(elicitation as Record<string, unknown> | undefined, "accept-and-connect");
      const result = await client.callTool({ name: "gws-mcp__drive_search", arguments: { query: "q" } });
      expect(asked).toHaveLength(0);
      expect(result.structuredContent).toMatchObject({ connect_url: `${BASE}/connect/tool_result-1` });
    });
  }
});
