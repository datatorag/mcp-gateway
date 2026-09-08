/**
 * The skill catalogue over MCP (SCRUM-224): prompts for clients that render
 * them, tools for clients that do not, both reading the one catalogue and
 * handing a model the same bytes.
 *
 * Driven through a real MCP client/server pair over InMemoryTransport, so
 * what is asserted is what a connected client actually receives.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Database } from "@datatorag-mcp/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { getAllSkills, getSkillBySlug, skillRunMessage } from "@/lib/skills";
import { skillApplyText } from "./skills-catalogue";

const trackToolCall = vi.fn().mockResolvedValue(undefined);
const trackSkillSearched = vi.fn().mockResolvedValue(undefined);
const trackSkillApplied = vi.fn().mockResolvedValue(undefined);
vi.mock("./track", () => ({
  trackToolCall: (...args: unknown[]) => trackToolCall(...args),
  trackSkillSearched: (...args: unknown[]) => trackSkillSearched(...args),
  trackSkillApplied: (...args: unknown[]) => trackSkillApplied(...args),
}));
vi.mock("./mcp-analytics", () => ({
  trackMcpToolsListed: vi.fn().mockResolvedValue(undefined),
}));
const listConnectedAccounts = vi.fn();
vi.mock("./connected-accounts", () => ({
  listConnectedAccounts: (...args: unknown[]) => listConnectedAccounts(...args),
}));
const listConnectedServiceIds = vi.fn();
vi.mock("./connected-services", () => ({
  listConnectedServiceIds: (...args: unknown[]) => listConnectedServiceIds(...args),
}));
vi.mock("./user-tools", () => ({
  listUserToolRows: vi.fn().mockResolvedValue([]),
  buildPluginServerUrl: () => "http://127.0.0.1:40000/mcp",
  callPluginToolOnce: vi.fn(),
}));
vi.mock("./billing/enforce", () => ({
  checkCallAllowance: vi.fn().mockResolvedValue({ allowed: true }),
}));

import { createMcpServer, BUILT_IN_TOOLS } from "./mcp-server";
import type { ConnectionPool } from "./pool";

const dbMock = {} as unknown as Database;
const poolMock = {
  acquire: vi.fn(),
  release: vi.fn(),
} as unknown as ConnectionPool;
const BASE = "https://example.com";

async function connectedClient() {
  const server = createMcpServer("user-1", dbMock, poolMock, { baseUrl: BASE });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

const ACCOUNTS = [
  {
    id: "a1",
    connectorType: "google-workspace",
    accountEmail: "work@example.com",
    label: null,
    isDefault: true,
    connectedAt: new Date("2026-01-01T00:00:00Z"),
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  listConnectedAccounts.mockResolvedValue(ACCOUNTS);
  listConnectedServiceIds.mockResolvedValue(new Set(["google-workspace"]));
});

describe("prompts: the catalogue for clients that render prompts", () => {
  it("lists one prompt per published skill, with an optional account argument", async () => {
    const client = await connectedClient();
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(
      getAllSkills()
        .map((s) => s.slug)
        .sort()
    );
    const brief = prompts.find((p) => p.name === "morning-brief")!;
    expect(brief.title ?? brief.description).toBeTruthy();
    expect(brief.arguments?.map((a) => a.name)).toEqual(["account"]);
    expect(brief.arguments?.[0]?.required ?? false).toBe(false);
  });

  it("returns ONE user message: the connection preface and the verbatim run message", async () => {
    const client = await connectedClient();
    const res = await client.getPrompt({ name: "morning-brief", arguments: {} });
    expect(res.messages).toHaveLength(1);
    const m = res.messages[0]!;
    expect(m.role).toBe("user");
    expect(m.content.type).toBe("text");
    const text = (m.content as { text: string }).text;
    const skill = getSkillBySlug("morning-brief")!;
    expect(text.endsWith(skillRunMessage(skill))).toBe(true);
    expect(text).toContain("This run will use work@example.com");
    expect(text).toBe(
      skillApplyText(skill, {
        connected: new Set(["google-workspace"]),
        accounts: ACCOUNTS.map((a) => ({
          connectorType: a.connectorType,
          accountEmail: a.accountEmail,
          isDefault: a.isDefault,
        })),
        account: null,
        connectionsUrl: `${BASE}/dashboard/connections`,
      })
    );
  });

  it("honours the account argument and says what the skill needs when it is missing", async () => {
    listConnectedServiceIds.mockResolvedValue(new Set());
    listConnectedAccounts.mockResolvedValue([]);
    const client = await connectedClient();
    const res = await client.getPrompt({ name: "morning-brief", arguments: { account: "x@example.com" } });
    const text = (res.messages[0]!.content as { text: string }).text;
    expect(text).toContain("needs Google Workspace, which is not connected");
    expect(text).toContain(`${BASE}/dashboard/connections`);
    expect(text).not.toContain("x@example.com");
  });

  it("refuses an unknown prompt name rather than inventing one", async () => {
    const client = await connectedClient();
    await expect(client.getPrompt({ name: "no-such-skill", arguments: {} })).rejects.toThrow();
  });

  it("emits skill_applied via prompt, with the slug", async () => {
    const client = await connectedClient();
    await client.getPrompt({ name: "morning-brief", arguments: {} });
    expect(trackSkillApplied).toHaveBeenCalledWith(
      dbMock,
      "user-1",
      expect.objectContaining({ skill: "morning-brief", via: "prompt", surface: "mcp", runnable: true })
    );
  });
});

describe("tools: the same catalogue for clients that render tools only", () => {
  it("skills_search and skills_get are built-ins in the registry, declared read", () => {
    const byName = new Map(BUILT_IN_TOOLS.map((t) => [t.definition.name, t]));
    expect(byName.get("skills_search")?.approval).toBe("read");
    expect(byName.get("skills_get")?.approval).toBe("read");
  });

  it("skills_search returns the catalogue with what each skill needs and whether this user has it", async () => {
    const client = await connectedClient();
    const res = await client.callTool({ name: "skills_search", arguments: { query: "morning" } });
    const text = (res.content as Array<{ type: string; text: string }>)[0]!.text;
    const parsed = JSON.parse(text) as { skills: Array<Record<string, unknown>> };
    const brief = parsed.skills.find((s) => s.slug === "morning-brief")!;
    expect(brief.runnable).toBe(true);
    expect(brief.needs).toEqual([
      { service: "google-workspace", name: "Google Workspace", connected: true },
    ]);
    expect(trackSkillSearched).toHaveBeenCalledWith(
      dbMock,
      "user-1",
      expect.objectContaining({ query: "morning", results: parsed.skills.length, surface: "mcp" })
    );
  });

  it("skills_get hands over EXACTLY what the prompt hands over", async () => {
    const client = await connectedClient();
    const viaTool = await client.callTool({ name: "skills_get", arguments: { slug: "morning-brief" } });
    const viaPrompt = await client.getPrompt({ name: "morning-brief", arguments: {} });
    const toolText = (viaTool.content as Array<{ type: string; text: string }>)[0]!.text;
    const promptText = (viaPrompt.messages[0]!.content as { text: string }).text;
    expect(toolText).toBe(promptText);
    expect(trackSkillApplied).toHaveBeenCalledWith(
      dbMock,
      "user-1",
      expect.objectContaining({ skill: "morning-brief", via: "tool" })
    );
  });

  it("skills_get with no or an unknown slug answers with the catalogue's slugs, not an error", async () => {
    const client = await connectedClient();
    const res = await client.callTool({ name: "skills_get", arguments: { slug: "no-such-skill" } });
    expect(res.isError ?? false).toBe(false);
    const text = (res.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).toContain("morning-brief");
    expect(trackSkillApplied).not.toHaveBeenCalled();
  });
});
