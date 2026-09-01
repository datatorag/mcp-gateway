import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@datatorag-mcp/db";

/**
 * The SCRUM-188 boundary suite: the agent resolves its tools as an ordinary
 * in-process client of the gateway's own MCP, and the properties that make
 * that safe are asserted at the boundary the model actually sees.
 *
 * Three claims, each of which has been proven ABLE TO FAIL (the write gate
 * by deliberate sabotage of requireApprovalFor, the metering claim by its
 * construction below):
 *
 *  1. Every tool arrives with an approval requirement, fail-closed.
 *  2. One tool call is ONE event, emitted at the MCP layer with the agent's
 *     client identity — the agent layer emits nothing of its own.
 *  3. A request that cannot say who it is gets no tools at all.
 *
 * (Two suites this file replaces documented the deleted architecture: the
 * per-user HTTP plugin-client sessions, and the agent-side metering that
 * SCRUM-188 removes. Their contracts are gone by design, not lost.)
 */

const trackToolCall = vi.fn().mockResolvedValue(undefined);
vi.mock("@/gateway/track", () => ({
  trackToolCall: (...args: unknown[]) => trackToolCall(...args),
  trackConnectCardShown: vi.fn(),
}));
vi.mock("@/gateway/mcp-analytics", () => ({
  trackMcpToolsListed: vi.fn().mockResolvedValue(undefined),
}));
const listUserToolRows = vi.fn();
vi.mock("@/gateway/user-tools", () => ({
  listUserToolRows: (...args: unknown[]) => listUserToolRows(...args),
  buildPluginServerUrl: () => "http://127.0.0.1:40000/mcp",
  callPluginToolOnce: vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "plugin ok" }],
  }),
}));
vi.mock("@/gateway/billing/enforce", () => ({
  checkCallAllowance: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock("@/gateway/service-token", () => ({
  PLUGIN_SERVICE_MAP: { "gws-mcp": "google-workspace" },
  resolveServiceToken: vi.fn().mockResolvedValue({
    token: "tok",
    accountEmail: "user@example.com",
    scopes: null,
  }),
}));
vi.mock("@/gateway/connected-accounts", () => ({
  listConnectedAccounts: vi.fn().mockResolvedValue([]),
  accountsGrantingScope: vi.fn().mockResolvedValue([]),
  disconnectService: vi.fn(),
}));

const selectLimit = vi.fn();
const dbMock = {
  select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }),
} as unknown as Database;
vi.mock("@/lib/db", () => ({ getDb: () => dbMock }));

const {
  resolveUserPluginTools,
  buildPluginRequestContext,
  requireApprovalFor,
  AGENT_CLIENT_NAME,
  WEB_OAUTH_CLIENT_ID,
} = await import("./client");
const { BUILT_IN_TOOLS } = await import("@/gateway/mcp-server");

type ResolvedTool = {
  requireApproval?: boolean;
  execute?: (input: unknown) => Promise<unknown>;
  providerOptions?: unknown;
};

beforeEach(() => {
  trackToolCall.mockClear();
  selectLimit.mockReset();
  listUserToolRows.mockReset();
  // The registry the MCP server lists: one read, one write, one name the
  // classifier has never seen. Fail-closed means the stranger is gated.
  listUserToolRows.mockResolvedValue([
    {
      namespacedName: "gws-mcp__gmail_search",
      name: "gmail_search",
      description: "read",
      schema: { type: "object", properties: {} },
      requiredService: "google-workspace",
    },
    {
      namespacedName: "gws-mcp__gmail_send",
      name: "gmail_send",
      description: "write",
      schema: { type: "object", properties: {} },
      requiredService: "google-workspace",
    },
    {
      namespacedName: "gws-mcp__totally_new_tool",
      name: "totally_new_tool",
      description: "unknown to the classifier",
      schema: { type: "object", properties: {} },
      requiredService: "google-workspace",
    },
  ]);
  // The mcpServers row CallTool resolves the slug against.
  selectLimit.mockResolvedValue([
    { id: "srv-1", slug: "gws-mcp", containerPort: 40000, githubRepoUrl: null },
  ]);
});

async function resolve() {
  const requestContext = buildPluginRequestContext({ userId: "user-1" });
  return (await resolveUserPluginTools({ requestContext })) as Record<
    string,
    ResolvedTool
  >;
}

describe("the approval boundary (SCRUM-188)", () => {
  it("every tool the model can see carries an approval requirement, fail-closed", async () => {
    const tools = await resolve();

    // Plugin tools: read unprompted, write gated, stranger gated.
    expect(tools["gws-mcp__gmail_search"]!.requireApproval).toBe(false);
    expect(tools["gws-mcp__gmail_send"]!.requireApproval).toBe(true);
    expect(tools["gws-mcp__totally_new_tool"]!.requireApproval).toBe(true);

    // Built-ins arrive through the same listing with their DECLARED value.
    for (const entry of BUILT_IN_TOOLS) {
      const tool = tools[entry.definition.name];
      expect(tool, `built-in ${entry.definition.name} must be listed`).toBeDefined();
      expect(tool!.requireApproval).toBe(entry.approval === "write");
    }

    // The three surviving Mastra tools bypass the wrapper by construction,
    // so their DECLARED approvals are asserted here too, not assumed.
    expect(tools.request_connection!.requireApproval).toBe(false);
    expect(tools.show_mcp_config!.requireApproval).toBe(false);
    expect(tools.disconnect_service!.requireApproval).toBe(true);

    // And the whole surface is covered: nothing reaches the model without
    // a boolean on it.
    for (const [name, tool] of Object.entries(tools)) {
      expect(typeof tool.requireApproval, `${name} must carry an approval`).toBe(
        "boolean"
      );
    }
  });

  it("declares an approval on every BUILT_IN_TOOLS entry — the parity pin", () => {
    for (const entry of BUILT_IN_TOOLS) {
      expect(
        entry.approval === "read" || entry.approval === "write",
        `${entry.definition.name} must declare approval`
      ).toBe(true);
    }
  });

  it("classifies by declaration first, name second, fail-closed last", () => {
    expect(requireApprovalFor("echo")).toBe(false); // declared read
    expect(requireApprovalFor("gws-mcp__gmail_search")).toBe(false); // known read
    expect(requireApprovalFor("gws-mcp__gmail_send")).toBe(true); // write verb
    expect(requireApprovalFor("never_seen_before")).toBe(true); // fail closed
  });
});

describe("one call, one event, at the MCP layer (SCRUM-188/189)", () => {
  it("a tool call through the agent emits exactly one event, carrying the agent's client identity", async () => {
    const tools = await resolve();

    const result = await tools.echo!.execute!({ message: "hi" });

    // Exactly one emission for one call — the agent layer added none of its
    // own. The event is the MCP layer's, and it names the caller.
    expect(trackToolCall).toHaveBeenCalledTimes(1);
    const [, props] = trackToolCall.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(props.clientName).toBe(AGENT_CLIENT_NAME);
    expect(props.clientId).toBe(WEB_OAUTH_CLIENT_ID);
    expect((props.outcome as { source: string }).source).toBe("mcp");
    expect(JSON.stringify(result)).toContain("hi");
  });

  it("a plugin tool call also emits exactly once, from the MCP layer", async () => {
    const tools = await resolve();

    await tools["gws-mcp__gmail_search"]!.execute!({});

    expect(trackToolCall).toHaveBeenCalledTimes(1);
    const [, props] = trackToolCall.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(props.toolName).toBe("gws-mcp__gmail_search");
    expect(props.clientName).toBe(AGENT_CLIENT_NAME);
  });
});

describe("identity and shape", () => {
  it("resolves no tools at all when the request cannot say who it is", async () => {
    const requestContext = buildPluginRequestContext({ userId: "" });
    const tools = await resolveUserPluginTools({ requestContext });
    expect(tools).toEqual({});
  });

  it("keeps namespaced tool names intact and marks only the last MCP tool as the cache breakpoint", async () => {
    const tools = await resolve();
    const names = Object.keys(tools);
    expect(names).toContain("gws-mcp__gmail_send");

    // The breakpoint sits on the last MCP-listed tool (built-ins come after
    // plugin tools in the server's listing), and the introspection tools
    // that follow carry none — the invariant block ends where the cache
    // marker sits.
    const marked = Object.entries(tools)
      .filter(([, t]) => t.providerOptions !== undefined)
      .map(([name]) => name);
    expect(marked).toEqual(["echo"]);
  });
});
