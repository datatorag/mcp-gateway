/**
 * SCRUM-511, the whole path: a connector whose tools the vendor's own MCP
 * server serves, listed and called through the same handlers as a plugin's.
 * The vendor is a stand-in made from the SDK's own server over real HTTP;
 * the listing, the dispatch, the forwarder, and the metering rule are the
 * product's.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("./connected-services", () => ({ listConnectedServiceIds: vi.fn(async () => new Set(["posthog", "google-workspace"])) }));
vi.mock("./gws-run-access", async (orig) => ({
  ...(await orig<typeof import("./gws-run-access")>()),
  gwsRunHiddenFrom: vi.fn(async () => false),
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
// PostHog's vendor, pointed at the stand-in. Everything else about it is
// the real registry's: its slug, its name, the plugin it supersedes.
const fake = vi.hoisted(() => ({ url: "" }));
vi.mock("./upstream-tools", async (orig) => {
  const real = await orig<typeof import("./upstream-tools")>();
  const at = <T extends { upstream: { url: string } }>(c: T): T => ({ ...c, upstream: { ...c.upstream, url: fake.url } });
  return {
    ...real,
    vendorServed: (slug: string) => {
      const c = real.vendorServed(slug);
      return c ? at(c) : undefined;
    },
    vendorConnectors: () => real.vendorConnectors().map(at),
  };
});

import { createMcpServer } from "./mcp-server";
import { clearUpstreamListings } from "./upstream-tools";
import { classifyOutcome } from "./usage/classify";
import { startFakeVendor, type FakeVendor } from "../test-utils/fake-vendor";
import type { ConnectionPool } from "./pool";

let vendor: FakeVendor;
/** The arguments the vendor's `exec` was called with. */
const received: Record<string, unknown>[] = [];
let listed = ["exec"];

beforeAll(async () => {
  vendor = await startFakeVendor(
    (mcp) => {
      if (listed.includes("exec")) {
        mcp.tool(
          "exec",
          "Run a PostHog command. The vendor's own words.",
          { command: z.string(), context: z.string() },
          async (args) => {
            received.push(args);
            if (args.command.startsWith("call broken")) return { content: [{ type: "text", text: "no such insight" }], isError: true };
            return { content: [{ type: "text", text: `ran ${args.command.split(" ")[0]}` }] };
          }
        );
      }
    },
    (app) => {
      app.post("/mcp-401", (_req, res) => void res.status(401).json({ error: "invalid_token" }));
    }
  );
});

afterAll(async () => {
  await vendor.close();
});

// The registry as it stands in this release: the plugin's own row is still
// there, with a tool of the ten, beside another connector's tool.
const POSTHOG_ROW = { id: "srv-posthog", slug: "posthog-mcp", containerPort: 40005, githubRepoUrl: null };
const REGISTRY_TOOLS = [
  {
    namespacedName: "posthog-mcp__posthog_project_get",
    description: "ours, superseded",
    inputSchemaJson: { type: "object", properties: {} },
    readOnlyHint: true,
    destructiveHint: null,
    serverSlug: "posthog-mcp",
  },
  {
    namespacedName: "gws-mcp__gmail_search",
    description: "search mail",
    inputSchemaJson: { type: "object", properties: { query: { type: "string" } } },
    readOnlyHint: true,
    destructiveHint: null,
    serverSlug: "gws-mcp",
  },
];

/** A query that answers by its table, whatever is chained onto it. */
function rowsFor(table: unknown, joined: boolean): unknown[] {
  if (table === tools && joined) return REGISTRY_TOOLS;
  if (table === mcpServers) return [POSTHOG_ROW];
  return [];
}
const dbMock = {
  select: () => ({
    from: (table: unknown) => {
      let joined = false;
      const chain: Record<string, unknown> = {
        innerJoin: () => ((joined = true), chain),
        where: () => chain,
        orderBy: () => chain,
        limit: async () => rowsFor(table, joined),
        then: (ok: (rows: unknown[]) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(rowsFor(table, joined)).then(ok, fail),
      };
      return chain;
    },
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

const logged: string[] = [];
const spies = (["log", "warn", "error", "info"] as const).map((level) =>
  vi.spyOn(console, level).mockImplementation((...parts: unknown[]) => void logged.push(parts.map(String).join(" ")))
);

beforeEach(() => {
  trackToolCall.mockClear();
  resolveServiceToken.mockReset();
  clearUpstreamListings();
  vendor.seen.length = 0;
  received.length = 0;
  logged.length = 0;
  listed = ["exec"];
  fake.url = `${vendor.base}/mcp`;
  resolveServiceToken.mockResolvedValue({ token: "posthog-user-token", accountEmail: "42", scopes: null });
});

afterEach(() => {
  for (const spy of spies) spy.mockClear();
});

const text = (result: unknown) =>
  ((result as { content?: unknown }).content as { type: string; text: string }[]).map((c) => c.text).join("\n");

describe("the tool list of a user with PostHog connected", () => {
  it("has PostHog's own tool, in PostHog's words, under the posthog prefix, and nothing of the plugin it replaced", async () => {
    const { tools: list } = await (await client()).listTools();
    const names = list.map((t) => t.name);
    expect(names).toContain("posthog__exec");
    expect(names.filter((n) => n.startsWith("posthog-mcp__"))).toEqual([]);
    // Another connector's tool is listed as it was.
    expect(names).toContain("gws-mcp__gmail_search");

    const exec = list.find((t) => t.name === "posthog__exec")!;
    expect(exec.description).toBe("Run a PostHog command. The vendor's own words.");
    expect(Object.keys(exec.inputSchema.properties ?? {}).sort()).toEqual(["account", "command", "context"]);
    expect(exec.inputSchema.required).toEqual(["command", "context"]);
    // Able to change data, and not undoable, whatever the vendor's listing says.
    expect(exec.annotations).toEqual({ readOnlyHint: false, destructiveHint: true });
  });

  it("has no PostHog tool, and every other tool, when PostHog's server cannot be reached", async () => {
    fake.url = "http://127.0.0.1:9/mcp";
    const names = (await (await client()).listTools()).tools.map((t) => t.name);
    expect(names.filter((n) => n.startsWith("posthog"))).toEqual([]);
    expect(names).toContain("gws-mcp__gmail_search");
  });

  it("has no PostHog tool when the stored authorization cannot be used", async () => {
    resolveServiceToken.mockResolvedValue({ refreshFailed: true, reconnectNeeded: true, accountEmail: "42" });
    const names = (await (await client()).listTools()).tools.map((t) => t.name);
    expect(names.filter((n) => n.startsWith("posthog"))).toEqual([]);
    expect(vendor.seen).toEqual([]);
  });
});

describe("a call to PostHog's tool", () => {
  const SECRET = "SELECT email FROM persons WHERE name = 'a-private-name'";
  const call = async (command: string, extra: Record<string, unknown> = {}) =>
    (await client()).callTool({ name: "posthog__exec", arguments: { command, context: "why-words-stay-private", ...extra } });

  it("reaches PostHog with the user's token as a bearer and nothing else, and the answer comes back as PostHog gave it", async () => {
    const result = await call("info project-get");
    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([{ type: "text", text: "ran info" }]);
    expect(vendor.seen.length).toBeGreaterThan(0);
    for (const h of vendor.seen) {
      expect(h.authorization).toBe("Bearer posthog-user-token");
      expect(h["x-user-token"]).toBeUndefined();
      expect(Object.keys(h).filter((k) => k.startsWith("x-posthog"))).toEqual([]);
    }
  });

  it("picks the account with our `account` argument and never forwards it", async () => {
    await call("info project-get", { account: "77" });
    expect(resolveServiceToken).toHaveBeenCalledWith(dbMock, "user-1", "posthog", "77");
    expect(received).toEqual([{ command: "info project-get", context: "why-words-stay-private" }]);
  });

  it("writes one usage row named for the verb and the PostHog tool, with no argument in it", async () => {
    await call(`call --json execute-sql {"query": "${SECRET}"}`);
    expect(trackToolCall).toHaveBeenCalledOnce();
    const [, props] = trackToolCall.mock.calls[0];
    expect(props).toMatchObject({
      userId: "user-1",
      toolName: "posthog__exec:call:execute-sql",
      connectorType: "posthog",
      accountEmail: "42",
    });
    expect(classifyOutcome(props.outcome)).toEqual({ status: "success", meter: true });
    expect(JSON.stringify(props)).not.toContain("a-private-name");
    expect(JSON.stringify(props)).not.toContain("why-words-stay-private");
  });

  it("logs no argument, no answer, and no token", async () => {
    await call(`call --json execute-sql {"query": "${SECRET}"}`);
    const everything = logged.join("\n");
    expect(everything).not.toContain("a-private-name");
    expect(everything).not.toContain("why-words-stay-private");
    expect(everything).not.toContain("posthog-user-token");
    expect(everything).not.toContain("ran call");
  });

  it("passes on an error PostHog reports in PostHog's words, and keeps none of those words in the usage row", async () => {
    const result = await call("call broken-insight {}");
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("no such insight");
    const [, props] = trackToolCall.mock.calls[0];
    expect(props.toolName).toBe("posthog__exec:call:broken-insight");
    expect(props.errorMessage).toBe("PostHog reported an error for this call.");
    expect(JSON.stringify(props)).not.toContain("no such insight");
  });

  it("when PostHog cannot be reached: a tool we know goes on to a fixed failure, and any other name is neither sent nor recorded", async () => {
    fake.url = "http://127.0.0.1:9/mcp";
    const known = await call("info project-get");
    expect(known.isError).toBe(true);
    const [, props] = trackToolCall.mock.calls[0];
    expect(props.toolName).toBe("posthog__exec:info:project-get");
    expect(props.errorMessage).toBe("PostHog's MCP server: unreachable.");
    expect(classifyOutcome(props.outcome).meter).toBe(false);

    trackToolCall.mockClear();
    logged.length = 0;
    const invented = await (await client()).callTool({ name: "posthog__a-private-name", arguments: {} });
    expect(invented.isError).toBe(true);
    expect(trackToolCall).not.toHaveBeenCalled();
    expect(logged.join("\n")).not.toContain("a-private-name");
  });

  it("refuses a tool PostHog does not list to this account, before any call", async () => {
    await (await client()).listTools();
    const before = received.length;
    const result = await (await client()).callTool({ name: "posthog__delete-everything", arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe('PostHog does not offer a tool named "delete-everything".');
    expect(received.length).toBe(before);
    expect(trackToolCall).not.toHaveBeenCalled();
  });

  it("refuses a name of the plugin it replaced as an unknown tool, with no token read and nothing sent", async () => {
    const result = await (await client()).callTool({ name: "posthog-mcp__posthog_project_get", arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Unknown tool");
    expect(resolveServiceToken).not.toHaveBeenCalled();
    expect(vendor.seen).toEqual([]);
  });

  it("sends a user with no PostHog connection to connect, and PostHog hears nothing", async () => {
    resolveServiceToken.mockResolvedValue(null);
    const result = await call("info project-get");
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/not connected/i);
    expect(vendor.seen).toEqual([]);
    const [, props] = trackToolCall.mock.calls[0];
    expect(classifyOutcome(props.outcome).meter).toBe(false);
  });

  it("when PostHog refuses the stored token: one forced refresh settles it, and the call is not metered", async () => {
    fake.url = `${vendor.base}/mcp-401`;
    const result = await call("info project-get");
    expect(result.isError).toBe(true);
    expect(resolveServiceToken).toHaveBeenCalledWith(dbMock, "user-1", "posthog", "42", { forceRefresh: true });
    const last = trackToolCall.mock.calls.at(-1)![1];
    expect(classifyOutcome(last.outcome).meter).toBe(false);
  });
});
