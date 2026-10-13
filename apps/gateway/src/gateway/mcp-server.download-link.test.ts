/**
 * SCRUM-420 at the dispatch: the download link tool is a built-in that is
 * listed, attended and refused when nobody is present, and the gateway
 * refuses any call that carries a live link before it reaches a tool.
 *
 * Driven through a real client/server pair over InMemoryTransport, as
 * mcp-server.file-crossing.test.ts is. The store is the real one; the read
 * from the source is a stand-in.
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
  accountsGrantingScope: vi.fn().mockResolvedValue([]),
}));
const callPluginToolOnce = vi.fn();
vi.mock("./user-tools", () => ({
  listUserToolRows: vi.fn().mockResolvedValue([]),
  buildPluginServerUrl: (row: { slug: string }) => `http://127.0.0.1:40000/${row.slug}/mcp`,
  callPluginToolOnce: (...args: unknown[]) => callPluginToolOnce(...args),
}));
const checkCallAllowance = vi.fn();
vi.mock("./billing/enforce", () => ({
  checkCallAllowance: (...args: unknown[]) => checkCallAllowance(...args),
}));
vi.mock("./admin", () => ({ isAdmin: vi.fn().mockResolvedValue(false) }));
vi.mock("./service-token", () => ({
  PLUGIN_SERVICE_MAP: { "gws-mcp": "google-workspace", "atlassian-mcp": "atlassian" },
  resolveServiceToken: vi.fn().mockResolvedValue({
    token: "source-token-fixture",
    accountEmail: "mail@example.com",
    scopes: "https://www.googleapis.com/auth/gmail.modify",
  }),
}));

import { createMcpServer } from "./mcp-server";
import type { ConnectionPool } from "./pool";
import { inspectLink, resetDownloadLinks, DOWNLOAD_PATH } from "./file-download";

const FILE = Buffer.from("From: a@example.com\r\nSubject: fixture\r\n\r\nbody\r\n");

const dbMock = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => [{ id: "srv-1", slug: "gws-mcp", containerPort: 40000, githubRepoUrl: null }],
      }),
    }),
  }),
} as unknown as Database;
const poolMock = { acquire: vi.fn(), release: vi.fn() } as unknown as ConnectionPool;

async function connectedClient(opts: Parameters<typeof createMcpServer>[3] = { baseUrl: "https://gw.example.test" }) {
  const server = createMcpServer("user-1", dbMock, poolMock, opts);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

const textOf = (result: unknown) =>
  ((result as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text).join(" ");

const REF = { type: "gmail_message", message_id: "msg-fixture-1" };

beforeEach(() => {
  vi.clearAllMocks();
  checkCallAllowance.mockResolvedValue({ allowed: true });
  resetDownloadLinks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(new Uint8Array(FILE), {
        status: 200,
        headers: { "Content-Type": "message/rfc822", "X-File-Name": encodeURIComponent("fixture.eml") },
      })
    )
  );
});

async function mintThrough(client: Client): Promise<{ url: string; token: string }> {
  const result = await client.callTool({ name: "file_download_link", arguments: { file: REF } });
  expect(result.isError ?? false).toBe(false);
  const url = String(JSON.parse(textOf(result)).link.url);
  return { url, token: url.split(DOWNLOAD_PATH)[1] };
}

describe("file_download_link", () => {
  it("is listed, with a description that says a link to the file comes back", async () => {
    const client = await connectedClient();
    const tool = (await client.listTools()).tools.find((t) => t.name === "file_download_link");
    expect(tool).toBeDefined();
    expect(tool!.description).toMatch(/download link/);
    expect(tool!.inputSchema.required).toEqual(["file"]);
    // Describes, never instructs.
    expect(tool!.description).not.toMatch(/\b(always|never|must|do not|don't|should)\b/i);
  });

  it("answers a link on the origin the session was built with, and is tracked once as a metered built-in", async () => {
    const client = await connectedClient();
    const { url } = await mintThrough(client);
    expect(url.startsWith(`https://gw.example.test${DOWNLOAD_PATH}`)).toBe(true);
    expect(trackToolCall).toHaveBeenCalledTimes(1);
    const props = trackToolCall.mock.calls[0][1];
    expect(props).toMatchObject({
      toolName: "file_download_link",
      errorMessage: null,
      outcome: { thrown: false, isError: false, builtin: true, meteredBuiltin: true },
    });
    // The link, the name and the hash are in the tool result and nowhere on the event.
    expect(JSON.stringify(props)).not.toContain(url.split(DOWNLOAD_PATH)[1].split(".")[0]);
    expect(JSON.stringify(props)).not.toContain("fixture.eml");
  });

  it("uses the download origin when the session has no base of its own (the agent's server)", async () => {
    const client = await connectedClient({ surface: "agent", downloadBaseUrl: "https://gw.example.test" });
    expect((await mintThrough(client)).url.startsWith("https://gw.example.test/files/d/")).toBe(true);
  });

  it("stops at the plan's allowance like a plugin call, before it reads anything", async () => {
    checkCallAllowance.mockResolvedValue({ allowed: false, message: "You have used this month's calls." });
    const client = await connectedClient();
    const result = await client.callTool({ name: "file_download_link", arguments: { file: REF } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("You have used this month's calls.");
    expect(fetch).not.toHaveBeenCalled();
    // An unmetered built-in is not asked.
    checkCallAllowance.mockClear();
    await client.callTool({ name: "echo", arguments: { message: "hi" } });
    expect(checkCallAllowance).not.toHaveBeenCalled();
  });

  it("is neither listed nor callable when nobody is in the conversation", async () => {
    const client = await connectedClient({ baseUrl: "https://gw.example.test", unattended: true });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain("file_download_link");
    expect(names).toContain("echo");
    // The call lookup is the guard; the listing is presentation.
    const result = await client.callTool({ name: "file_download_link", arguments: { file: REF } });
    expect(result.isError).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(textOf(result)).not.toContain(DOWNLOAD_PATH);
  });
});

describe("the gateway does not carry its own link", () => {
  it("refuses a built-in call that carries a live link, runs nothing and cancels the link", async () => {
    const client = await connectedClient();
    const { url, token } = await mintThrough(client);
    trackToolCall.mockClear();

    const result = await client.callTool({ name: "echo", arguments: { message: `see ${url}` } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("cannot be passed to another tool");
    expect(textOf(result)).not.toContain("[datatorag-mcp echo]");
    expect(textOf(result)).not.toContain(token);
    expect(inspectLink(token)).toEqual({ kind: "cancelled" });
    expect(trackToolCall).toHaveBeenCalledTimes(1);
    expect(trackToolCall.mock.calls[0][1]).toMatchObject({
      toolName: "echo",
      outcome: { isError: true, builtin: true },
    });
    expect(JSON.stringify(trackToolCall.mock.calls[0][1])).not.toContain(token.split(".")[0]);
  });

  it("refuses a plugin call that carries one, before the plugin is looked up", async () => {
    const client = await connectedClient();
    const { token } = await mintThrough(client);
    const result = await client.callTool({
      name: "gws-mcp__gmail_send",
      arguments: { to: "x@example.com", subject: "hi", body: Buffer.from(token).toString("base64") },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("cannot be passed to another tool");
    expect(callPluginToolOnce).not.toHaveBeenCalled();
    expect(inspectLink(token)).toEqual({ kind: "cancelled" });
  });

  it("does not get in the way of a call that carries no link", async () => {
    const client = await connectedClient();
    await mintThrough(client);
    const result = await client.callTool({ name: "echo", arguments: { message: "plain" } });
    expect(result.isError ?? false).toBe(false);
    expect(textOf(result)).toContain("[datatorag-mcp echo] plain");
  });
});
