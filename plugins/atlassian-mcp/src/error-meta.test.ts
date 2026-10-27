import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./create-server.js";
import { AtlassianClient } from "./atlassian-client.js";
import { ERROR_META_KEY, errorMetaFor } from "./error-meta.js";

/* What a failed call says about whose failure it was (SCRUM-154), through the
 * MCP server the way the gateway calls it, against a stubbed fetch that
 * answers what Atlassian answers. The gateway meters on this field. */

const CLOUD = "cloud-1";
const JIRA = `https://api.atlassian.com/ex/jira/${CLOUD}/rest/api/3`;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** The site lookup answers; the issue read answers `issue()`. */
function jira(issue: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/oauth/token/accessible-resources")) {
        return json([{ id: CLOUD, name: "example", url: "https://example.atlassian.net" }]);
      }
      if (url.startsWith(`${JIRA}/issue/PROJ-1`)) return issue();
      throw new Error(`unexpected ${url}`);
    })
  );
}

async function getIssue(client = new AtlassianClient({ accessToken: "t" })) {
  const server = createMcpServer(client);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(a), mcp.connect(b)]);
  return (await mcp.callTool({ name: "jira_get_issue", arguments: { issue_key: "PROJ-1" } })) as {
    isError?: boolean;
    _meta?: Record<string, unknown>;
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a failed call names its kind in _meta", () => {
  it.each([400, 403, 404, 429, 500, 503])("Jira's %i is an http error with its status", async (status) => {
    jira(() => json({ errorMessages: ["no"] }, status));
    const res = await getIssue();
    expect(res.isError).toBe(true);
    expect(res._meta?.[ERROR_META_KEY]).toEqual({ kind: "http", status });
  });

  it("a site lookup Atlassian refused keeps its status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401, statusText: "Unauthorized" })));
    const res = await getIssue();
    expect(res._meta?.[ERROR_META_KEY]).toEqual({ kind: "http", status: 401 });
  });

  it("a connection that failed is unreachable", async () => {
    jira(() => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
    });
    const res = await getIssue();
    expect(res._meta?.[ERROR_META_KEY]).toEqual({ kind: "unreachable" });
  });

  it("a call with no token is the plugin's own refusal", async () => {
    const res = await getIssue(new AtlassianClient());
    expect(res._meta?.[ERROR_META_KEY]).toEqual({ kind: "refused" });
  });

  it("a tool this plugin does not serve is unknown_tool", async () => {
    const server = createMcpServer(new AtlassianClient({ accessToken: "t" }));
    const [a, b] = InMemoryTransport.createLinkedPair();
    const mcp = new Client({ name: "test", version: "1.0.0" });
    await Promise.all([server.connect(a), mcp.connect(b)]);
    const res = (await mcp.callTool({ name: "not_a_tool", arguments: {} })) as { _meta?: Record<string, unknown> };
    expect(res._meta?.[ERROR_META_KEY]).toEqual({ kind: "unknown_tool" });
  });
});

describe("errorMetaFor", () => {
  it("a runtime error is a crash", () => {
    expect(errorMetaFor(new ReferenceError("x is not defined"))).toEqual({ kind: "crash" });
    expect(errorMetaFor(undefined)).toEqual({ kind: "crash" });
  });
});
