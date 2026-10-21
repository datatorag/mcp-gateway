import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./create-server.js";
import { NotionClient } from "./notion-client.js";
import { retryClock } from "./rate-limit-retry.js";
import { fakeFetch } from "./fixtures/fake-fetch.js";
import { recorded } from "./fixtures/load.js";
import { RATE_LIMITED } from "./fixtures/errors-documented.js";

/* Through the MCP server, the way the gateway calls it. What this pins is the
 * wiring: the dispatch hands each tool a client whose retry is decided by
 * that tool's read-only hint, so notion_search, a POST, is retried. */

const TOKEN = "fixture-bearer-not-a-real-token";

async function connect(client?: NotionClient) {
  const server = createMcpServer(client);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(a), mcp.connect(b)]);
  return mcp;
}

beforeEach(() => {
  vi.spyOn(retryClock, "sleep").mockResolvedValue();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the MCP server", () => {
  it("lists the eighteen tools with their annotations", async () => {
    const mcp = await connect(new NotionClient({ accessToken: TOKEN }));
    const { tools } = await mcp.listTools();
    expect(tools).toHaveLength(18);
    for (const t of tools) {
      const write = /^notion_(create|update|move|duplicate|delete)_/.test(t.name);
      expect(t.annotations, t.name).toMatchObject(
        write ? { readOnlyHint: false, destructiveHint: true } : { readOnlyHint: true, destructiveHint: false }
      );
    }
  });

  it("a write's refusal for rate is not sent again through the dispatch, and the wait comes back in words", async () => {
    const f = fakeFetch([{ status: 429, body: RATE_LIMITED, headers: { "Retry-After": "1" } }]);
    const mcp = await connect(new NotionClient({ accessToken: TOKEN }));
    const res = (await mcp.callTool({
      name: "notion_create_comment",
      arguments: { page_id: "122f53f3d53e4072842d9891b983e4e0", text: "hi" },
    })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(f.sent).toHaveLength(1);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/wait of 1 second before the next request/);
    expect(res.content[0].text).toMatch(/not sent again, because this tool changes content/);
  });

  it("an encoder refusal reaches the caller as words, with no write sent", async () => {
    const f = fakeFetch([{ status: 200, body: recorded("data-source").body }]);
    const mcp = await connect(new NotionClient({ accessToken: TOKEN }));
    const res = (await mcp.callTool({
      name: "notion_create_page",
      arguments: { parent_data_source_id: "fcfeab1774c94fac80268fdff653c6c5", properties: { "Membership Type": "Nobody" } },
    })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/"Nobody" is not an option of Membership Type/);
    expect(f.sent.map((r) => r.method)).toEqual(["GET"]);
  });

  it("a read-only tool's POST is retried on 429 through the dispatch", async () => {
    const f = fakeFetch([
      { status: 429, body: RATE_LIMITED, headers: { "Retry-After": "1" } },
      { status: 200, body: recorded("search-empty").body },
    ]);
    const mcp = await connect(new NotionClient({ accessToken: TOKEN }));
    const res = await mcp.callTool({ name: "notion_search", arguments: { query: "x" } });
    expect(res.isError).toBeFalsy();
    expect(f.sent).toHaveLength(2);
    expect(f.sent.every((r) => r.method === "POST")).toBe(true);
  });

  it("with no token, a call is refused in words and nothing is sent", async () => {
    const f = fakeFetch([]);
    const mcp = await connect();
    const res = (await mcp.callTool({ name: "notion_list_users", arguments: {} })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/No Notion access token/);
    expect(f.sent).toHaveLength(0);
  });

  it("an unknown tool is refused", async () => {
    const mcp = await connect(new NotionClient({ accessToken: TOKEN }));
    const res = (await mcp.callTool({ name: "notion_delete_everything", arguments: {} })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("Unknown tool: notion_delete_everything");
  });
});
