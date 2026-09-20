/**
 * Admin-only built-in tools (SCRUM-302): invisible AND unreachable.
 *
 * Two separate claims, because a filter on the listing is not a guard. A
 * client can call any name it likes without ever listing, so the listing
 * filter is presentation and the CALL check is the security boundary.
 *
 * The strong claim about the call is not "it refuses" but that the refusal
 * is INDISTINGUISHABLE from a name nobody ever registered. That is achieved
 * by construction rather than by imitation: the lookup returns nothing for a
 * non-admin, so the dispatch falls into the same unknown-tool branch a
 * made-up name takes. These tests compare the two answers rather than
 * matching either against a literal, so the day that wording changes they
 * still hold.
 *
 * No built-in declares an audience yet (SCRUM-303 registers the first three),
 * so the entry is injected into the real registry for the duration of a test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Database } from "@datatorag-mcp/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const trackToolCall = vi.fn().mockResolvedValue(undefined);
vi.mock("./track", () => ({
  trackToolCall: (...args: unknown[]) => trackToolCall(...args),
  trackSkillSearched: vi.fn().mockResolvedValue(undefined),
  trackSkillApplied: vi.fn().mockResolvedValue(undefined),
  trackSkillEvent: vi.fn().mockResolvedValue(undefined),
}));
const trackMcpToolsListed = vi.fn().mockResolvedValue(undefined);
vi.mock("./mcp-analytics", () => ({
  trackMcpToolsListed: (...args: unknown[]) => trackMcpToolsListed(...args),
}));
vi.mock("./connected-accounts", () => ({
  listConnectedAccounts: vi.fn().mockResolvedValue([]),
}));
vi.mock("./connected-services", () => ({
  listConnectedServiceIds: vi.fn().mockResolvedValue(new Set<string>()),
}));
vi.mock("./user-tools", () => ({
  listUserToolRows: vi.fn().mockResolvedValue([]),
  buildPluginServerUrl: () => "http://127.0.0.1:40000/mcp",
  callPluginToolOnce: vi.fn(),
}));
vi.mock("./billing/enforce", () => ({
  checkCallAllowance: vi.fn().mockResolvedValue({ allowed: true }),
}));

const isAdmin = vi.fn();
vi.mock("./admin", () => ({ isAdmin: (...a: unknown[]) => isAdmin(...a) }));

import {
  createMcpServer,
  BUILT_IN_TOOLS,
  visibleBuiltins,
  findVisibleBuiltin,
} from "./mcp-server";
import type { ConnectionPool } from "./pool";

const dbMock = {} as unknown as Database;
const poolMock = {
  acquire: vi.fn(),
  release: vi.fn(),
} as unknown as ConnectionPool;

const ADMIN_TOOL = "zz_admin_only_probe";
const MADE_UP = "zz_never_registered_probe";

const adminEntry: (typeof BUILT_IN_TOOLS)[number] = {
  definition: {
    name: ADMIN_TOOL,
    description: "Injected by the SCRUM-302 audience suite.",
    inputSchema: { type: "object", properties: {} },
  },
  approval: "read",
  audience: "admin",
  handler: async () => ({
    content: [{ type: "text" as const, text: "admin handler ran" }],
  }),
};

async function connectedClient(userId: string) {
  const server = createMcpServer(userId, dbMock, poolMock);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  BUILT_IN_TOOLS.push(adminEntry);
});

afterEach(() => {
  const i = BUILT_IN_TOOLS.indexOf(adminEntry);
  if (i !== -1) BUILT_IN_TOOLS.splice(i, 1);
});

describe("the injected entry is really in the registry", () => {
  it("guards every test below against being vacuous", () => {
    expect(BUILT_IN_TOOLS.some((t) => t.definition.name === ADMIN_TOOL)).toBe(true);
    // The injected one plus the three the runner registers (SCRUM-303).
    // Asserted as "the injected one is among them" rather than a count, so
    // registering a fourth admin tool does not fail this for no reason.
    const adminNames = BUILT_IN_TOOLS.filter((t) => t.audience === "admin").map((t) => t.definition.name);
    expect(adminNames).toContain(ADMIN_TOOL);
    expect(adminNames).toEqual(expect.arrayContaining(["tests_run", "tests_status", "tests_results"]));
  });
});

describe("the helpers", () => {
  it("do not read the role at all when no entry declares an audience", async () => {
    // The ordinary path, which is every call today. A role read per tool call
    // would be a cost paid by everyone for a feature nobody is using yet.
    const plain = BUILT_IN_TOOLS.filter((t) => !t.audience);
    expect(await visibleBuiltins(dbMock, "u", plain)).toBe(plain);
    expect(await findVisibleBuiltin(dbMock, "u", plain[0].definition.name, plain)).toBe(plain[0]);
    expect(isAdmin).not.toHaveBeenCalled();
  });

  it("do not read the role for a name that is not a built-in at all", async () => {
    expect(await findVisibleBuiltin(dbMock, "u", MADE_UP)).toBeUndefined();
    expect(isAdmin).not.toHaveBeenCalled();
  });

  it("hide an admin entry from a non-admin, both ways", async () => {
    isAdmin.mockResolvedValue(false);
    const names = (await visibleBuiltins(dbMock, "u")).map((t) => t.definition.name);
    expect(names).not.toContain(ADMIN_TOOL);
    expect(await findVisibleBuiltin(dbMock, "u", ADMIN_TOOL)).toBeUndefined();
  });

  it("show it to an admin, both ways", async () => {
    isAdmin.mockResolvedValue(true);
    const names = (await visibleBuiltins(dbMock, "u")).map((t) => t.definition.name);
    expect(names).toContain(ADMIN_TOOL);
    expect(await findVisibleBuiltin(dbMock, "u", ADMIN_TOOL)).toBe(adminEntry);
  });
});

describe("through a connected client", () => {
  it("a non-admin's tools/list omits it, and the event counts what was served", async () => {
    isAdmin.mockResolvedValue(false);
    const client = await connectedClient("ordinary-user");
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).not.toContain(ADMIN_TOOL);

    // `builtinTools` must be what this user was actually served, not the size
    // of the registry: the whole point of the filter is that those differ.
    const served = names.length;
    expect(trackMcpToolsListed).toHaveBeenCalledWith(
      expect.anything(),
      "ordinary-user",
      expect.objectContaining({ builtinTools: served, connectorTools: 0 })
    );
    expect(BUILT_IN_TOOLS.length).toBeGreaterThan(served);
  });

  it("an admin's tools/list contains it", async () => {
    isAdmin.mockResolvedValue(true);
    const client = await connectedClient("admin-user");
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain(ADMIN_TOOL);
  });

  it("a non-admin calling it by name gets the answer a name nobody registered gets", async () => {
    isAdmin.mockResolvedValue(false);
    const client = await connectedClient("ordinary-user");

    const refused = await client.callTool({ name: ADMIN_TOOL, arguments: {} });
    const unknown = await client.callTool({ name: MADE_UP, arguments: {} });

    // Compared to each other, not to a literal: the claim is that the two are
    // the same answer, and it must survive the wording changing.
    expect(refused.isError).toBe(unknown.isError);
    const textOf = (r: typeof refused) =>
      (r.content as { type: string; text: string }[])[0].text;
    expect(textOf(refused).replace(ADMIN_TOOL, "NAME")).toBe(
      textOf(unknown).replace(MADE_UP, "NAME")
    );
    // And the handler did not run on the way to that answer.
    expect(textOf(refused)).not.toContain("admin handler ran");
  });

  it("the usage event for that refusal has the shape of the unknown-name event", async () => {
    isAdmin.mockResolvedValue(false);
    const client = await connectedClient("ordinary-user");

    await client.callTool({ name: ADMIN_TOOL, arguments: {} });
    const refusedEvent = trackToolCall.mock.calls.at(-1)?.[1];
    trackToolCall.mockClear();

    await client.callTool({ name: MADE_UP, arguments: {} });
    const unknownEvent = trackToolCall.mock.calls.at(-1)?.[1];

    const shape = (e: Record<string, unknown> | undefined) => {
      const json = JSON.stringify(e ?? null)
        .split(ADMIN_TOOL).join("NAME")
        .split(MADE_UP).join("NAME");
      return JSON.parse(json);
    };
    expect(shape(refusedEvent)).toEqual(shape(unknownEvent));
  });

  it("an admin calling it reaches the handler", async () => {
    isAdmin.mockResolvedValue(true);
    const client = await connectedClient("admin-user");
    const res = await client.callTool({ name: ADMIN_TOOL, arguments: {} });
    expect((res.content as { text: string }[])[0].text).toBe("admin handler ran");
  });
});
