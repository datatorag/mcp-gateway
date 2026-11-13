/**
 * official-mcp-proxy, the success criterion: a call to a vendor-served tool
 * goes through the same CallTool dispatch as a plugin call and writes the
 * same one usage row, attributed to the user's service, account and tool.
 * The vendor is a fake made from the SDK's own server over real HTTP; the
 * dispatch, the choice of plugin or vendor, the adapter and the metering
 * rule are the product's.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { mcpServers, tools, type Database } from "@datatorag-mcp/db";

const trackToolCall = vi.fn().mockResolvedValue(undefined);
vi.mock("./track", () => ({
  trackConnectLinkEvent: vi.fn(async () => undefined),
  trackToolCall: (...args: unknown[]) => trackToolCall(...args),
}));
vi.mock("./mcp-analytics", () => ({ trackMcpToolsListed: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./connected-accounts", () => ({
  listConnectedAccounts: vi.fn().mockResolvedValue([]),
  accountsGrantingScope: vi.fn().mockResolvedValue([]),
}));
vi.mock("./billing/enforce", () => ({ checkCallAllowance: vi.fn().mockResolvedValue({ allowed: true }) }));
const resolveServiceToken = vi.fn();
vi.mock("./service-token", async (orig) => ({
  ...(await orig<typeof import("./service-token")>()),
  resolveServiceToken: (...args: unknown[]) => resolveServiceToken(...args),
}));
vi.mock("./user-email", () => ({ resolveUserEmail: vi.fn().mockResolvedValue("member@example.com") }));
vi.mock("./connect-links", async (orig) => ({
  ...(await orig<typeof import("./connect-links")>()),
  issueConnectLink: vi.fn(async () => null),
}));
// Slack's vendor, pointed at the fake. Everything else about the registry
// is the real one, including the vendor's own slug.
const fake = vi.hoisted(() => ({ url: "" }));
vi.mock("./connectors/registry", async (orig) => {
  const real = await orig<typeof import("./connectors/registry")>();
  return {
    ...real,
    vendorServed: (slug: string) => {
      const c = real.vendorServed(slug);
      return c ? { ...c, upstream: { ...c.upstream, url: fake.url } } : undefined;
    },
  };
});

import { createMcpServer } from "./mcp-server";
import { classifyOutcome } from "./usage/classify";
import { startFakeVendor, type FakeVendor } from "../test-utils/fake-vendor";
import type { ConnectionPool } from "./pool";

let vendor: FakeVendor;

beforeAll(async () => {
  vendor = await startFakeVendor((mcp) => {
    mcp.tool("slack_search_public", { query: z.string() }, async ({ query }) => ({
      content: [{ type: "text", text: `results for ${query}` }],
    }));
  });
});

afterAll(async () => {
  await vendor.close();
});

const SERVER_ROW = { id: "srv-slack-hosted", slug: "slack-hosted", containerPort: 40009, githubRepoUrl: null };
const TOOL_ROW = {
  id: "tool-1",
  schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
};
let toolRows: unknown[] = [TOOL_ROW];

/** Answers by table: the server row, and the tool's registry row. */
const dbMock = {
  select: () => ({
    from: (table: unknown) => ({
      where: () => ({
        limit: async () => (table === mcpServers ? [SERVER_ROW] : table === tools ? toolRows : []),
      }),
    }),
  }),
} as unknown as Database;
const poolMock = { acquire: vi.fn(), release: vi.fn() } as unknown as ConnectionPool;

async function client() {
  const s = createMcpServer("user-1", dbMock, poolMock, { baseUrl: "https://gw.example.test" });
  const c = new Client({ name: "claude-ai", version: "1.0.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await s.connect(st);
  await c.connect(ct);
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
  vendor.seen.length = 0;
  toolRows = [TOOL_ROW];
  fake.url = `${vendor.base}/mcp`;
  resolveServiceToken.mockResolvedValue({ token: "slack-user-token", accountEmail: "me@example.com", scopes: null });
});

describe("a call to a vendor-served tool (official-mcp-proxy)", () => {
  it("reaches the vendor with the user's token as a bearer, and writes one usage row for the user's service, account and tool", async () => {
    const result = await (await client()).callTool({ name: "slack-hosted__slack_search_public", arguments: { query: "roadmap" } });

    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([{ type: "text", text: "results for roadmap" }]);
    expect(vendor.seen.length).toBeGreaterThan(0);
    for (const h of vendor.seen) {
      expect(h.authorization).toBe("Bearer slack-user-token");
      expect(h["x-user-token"]).toBeUndefined();
    }
    expect(resolveServiceToken).toHaveBeenCalledWith(dbMock, "user-1", "slack", undefined);

    expect(trackToolCall).toHaveBeenCalledOnce();
    const [, props] = trackToolCall.mock.calls[0];
    expect(props).toMatchObject({
      userId: "user-1",
      toolName: "slack-hosted__slack_search_public",
      connectorType: "slack",
      accountEmail: "me@example.com",
    });
    expect(classifyOutcome(props.outcome)).toEqual({ status: "success", meter: true });
  });

  it("a tool the vendor offers but we have not registered is refused before any request, and nothing is metered", async () => {
    toolRows = [];
    const result = await (await client()).callTool({ name: "slack-hosted__slack_search_public", arguments: { query: "x" } });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "This tool is not offered." }]);
    expect(vendor.seen).toEqual([]);
    expect(resolveServiceToken).not.toHaveBeenCalled();
    expect(trackToolCall).not.toHaveBeenCalled();
  });

});
