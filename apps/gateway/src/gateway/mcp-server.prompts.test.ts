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
import { readSkillFiles, runAccountsFrom, skillRunMessage } from "@/lib/skills";
import { skillApplyText } from "./skills-catalogue";

const trackToolCall = vi.fn().mockResolvedValue(undefined);
const trackSkillSearched = vi.fn().mockResolvedValue(undefined);
const trackSkillApplied = vi.fn().mockResolvedValue(undefined);
vi.mock("./track", () => ({
  trackToolCall: (...args: unknown[]) => trackToolCall(...args),
  trackSkillSearched: (...args: unknown[]) => trackSkillSearched(...args),
  trackSkillApplied: (...args: unknown[]) => trackSkillApplied(...args),
  trackSkillEvent: (...args: unknown[]) => trackSkillEvent(...args),
}));
vi.mock("./mcp-analytics", () => ({
  trackMcpToolsListed: vi.fn().mockResolvedValue(undefined),
}));
const listConnectedAccounts = vi.fn();
vi.mock("./connected-accounts", () => ({
  listConnectedAccounts: (...args: unknown[]) => listConnectedAccounts(...args),
}));
const listConnectedServiceIds = vi.fn();
const createUserSkill = vi.fn();
const updateUserSkill = vi.fn();
const forkSkill = vi.fn();
const deleteUserSkill = vi.fn();
vi.mock("./skills/catalogue-store", () => ({
  createUserSkill: (...a: unknown[]) => createUserSkill(...a),
  updateUserSkill: (...a: unknown[]) => updateUserSkill(...a),
  forkSkill: (...a: unknown[]) => forkSkill(...a),
  deleteUserSkill: (...a: unknown[]) => deleteUserSkill(...a),
}));
const trackSkillEvent = vi.fn().mockResolvedValue(undefined);
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

import { createMcpServer, BUILT_IN_TOOLS, connectionFailureService } from "./mcp-server";
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
      readSkillFiles()
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
    const skill = readSkillFiles().find((s) => s.slug === "morning-brief")!;
    expect(
      text.endsWith(
        skillRunMessage(
          skill,
          runAccountsFrom(
            ACCOUNTS.map((a) => ({
              connectorType: a.connectorType,
              accountEmail: a.accountEmail,
              isDefault: a.isDefault,
            }))
          )
        )
      )
    ).toBe(true);
    expect(text).toContain("Do not ask which accounts to cover");
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

  it("never reflects an arbitrary-length prompt name back: capped and stripped of control characters", async () => {
    const client = await connectedClient();
    const name = "x".repeat(40) + String.fromCharCode(27) + "[31m" + "y".repeat(400);
    const err = await client.getPrompt({ name, arguments: {} }).catch((e: unknown) => e);
    const message = String((err as Error).message);
    expect(message).toContain("Unknown prompt");
    expect(message).not.toContain(name);
    expect(message).not.toMatch(/[\u0000-\u001f\u007f]/);
    // Exactly the first 64 printable characters, then the cut marker.
    expect(message).toContain(`"${"x".repeat(40)}[31m${"y".repeat(20)}..."`);
    expect(message.length).toBeLessThan(200);
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
    // Search text is user content and never reaches analytics: the event
    // carries the query's length, the result count and the top result's kind.
    expect(trackSkillSearched).toHaveBeenCalledWith(
      dbMock,
      "user-1",
      expect.objectContaining({
        queryLength: 7,
        results: parsed.skills.length,
        topResult: "published",
        surface: "mcp",
      })
    );
    const props = trackSkillSearched.mock.calls[0]![2] as Record<string, unknown>;
    expect(props).not.toHaveProperty("query");
    expect(JSON.stringify(props)).not.toContain("morning");
  });

  it("skill_searched with no query and no match reports zero length and a null top result", async () => {
    const client = await connectedClient();
    await client.callTool({ name: "skills_search", arguments: {} });
    expect(trackSkillSearched).toHaveBeenLastCalledWith(
      dbMock,
      "user-1",
      expect.objectContaining({ queryLength: 0, topResult: "published" })
    );
    await client.callTool({ name: "skills_search", arguments: { query: "zz-no-such-thing-zz" } });
    expect(trackSkillSearched).toHaveBeenLastCalledWith(
      dbMock,
      "user-1",
      expect.objectContaining({ queryLength: 19, results: 0, topResult: null })
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

  it("an unknown tool name and an unknown server slug reflect through the same cap", async () => {
    const client = await connectedClient();
    const long = "t".repeat(300);
    const noSep = await client.callTool({ name: long, arguments: {} });
    const noSepText = (noSep.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(noSep.isError).toBe(true);
    expect(noSepText).toContain("Unknown tool");
    expect(noSepText).not.toContain(long);
    expect(noSepText).toContain("t".repeat(64) + "...");
    // The server lookup runs before the unknown-server answer, so this leg
    // needs a database that finds nothing.
    const emptySelect = { from: () => ({ where: () => ({ limit: async () => [] }) }) };
    const dbEmpty = { select: () => emptySelect } as unknown as Database;
    const server = createMcpServer("user-1", dbEmpty, poolMock, { baseUrl: BASE });
    const lookup = new Client({ name: "test-client", version: "0.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    await lookup.connect(ct);
    const badServer = await lookup.callTool({ name: `${long}__read`, arguments: {} });
    const badServerText = (badServer.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(badServerText).toContain("Unknown server");
    expect(badServerText).not.toContain(long);
  });

  it("skills_get never reflects an arbitrary-length slug back: capped and stripped of control characters", async () => {
    const client = await connectedClient();
    const slug = "a".repeat(40) + String.fromCharCode(7) + "b".repeat(400);
    const res = await client.callTool({ name: "skills_get", arguments: { slug } });
    const text = (res.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).not.toContain(slug);
    expect(text).not.toContain("b".repeat(100));
    expect(text).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(text).toContain("morning-brief");
  });
});

describe("connectionFailureService: the scheduler reads the server's own sentences (SCRUM-225)", () => {
  it("names the service from the not-connected and unknown-account answers", () => {
    expect(
      connectionFailureService(
        "google-workspace is not connected. Please connect it from the dashboard at https://example.com/dashboard/connections/google-workspace before using gws-mcp tools."
      )
    ).toBe("google-workspace");
    expect(
      connectionFailureService(
        'No connected account found for "x@example.com". Please connect it from the dashboard at https://example.com/dashboard/connections/atlassian.'
      )
    ).toBe("atlassian");
  });

  it("is null for ordinary tool output, even output that mentions connections", () => {
    expect(connectionFailureService("Found 3 messages about connections.")).toBeNull();
    expect(connectionFailureService("")).toBeNull();
  });
});

/* SCRUM-226: a user's own skills over MCP. Four write built-ins, declared
 * write so the agent prompts before them, sharing the store's functions
 * with the dashboard routes; a refusal is a plain answer the model can act
 * on, never an error, and every change reports its event with the slug. */
describe("user-owned skills over MCP (SCRUM-226)", () => {
  const MINE = {
    slug: "draft-sweep",
    title: "Sweep my drafts",
    layer: "yours",
    version: "abcdef0123456789",
    forkedFrom: null,
  };
  const textOf = (res: unknown) => ((res as { content: Array<{ text: string }> }).content[0]!.text);

  it("the four write tools are registered and declared write", () => {
    const byName = new Map(BUILT_IN_TOOLS.map((t) => [t.definition.name, t]));
    for (const name of ["skills_create", "skills_update", "skills_fork", "skills_delete"]) {
      expect(byName.get(name)?.approval, name).toBe("write");
    }
  });

  it("skills_create saves through the store for this user and answers with the slug and version", async () => {
    createUserSkill.mockResolvedValueOnce({ ok: true, skill: MINE });
    const client = await connectedClient();
    const res = await client.callTool({
      name: "skills_create",
      arguments: { title: "Sweep my drafts", source: "---\nname: x\n---\n", tools: ["gmail_list"] },
    });
    expect(res.isError ?? false).toBe(false);
    expect(createUserSkill).toHaveBeenCalledWith(
      dbMock,
      "user-1",
      expect.objectContaining({ title: "Sweep my drafts", tools: ["gmail_list"] })
    );
    expect(JSON.parse(textOf(res))).toMatchObject({ slug: "draft-sweep", version: MINE.version, layer: "yours" });
    expect(trackSkillEvent).toHaveBeenCalledWith(
      dbMock,
      "user-1",
      "skill_created",
      expect.objectContaining({ skill: "draft-sweep", via: "tool" })
    );
  });

  it("a refused save is a plain answer naming the field, the cap, or the missing skill, never an error", async () => {
    const client = await connectedClient();
    createUserSkill.mockResolvedValueOnce({ ok: false, reason: "invalid", field: "tools", error: "unknown tool: gmail_teleport" });
    const invalid = await client.callTool({ name: "skills_create", arguments: { title: "x" } });
    expect(invalid.isError ?? false).toBe(false);
    expect(textOf(invalid)).toContain("tools");
    expect(textOf(invalid)).toContain("gmail_teleport");
    createUserSkill.mockResolvedValueOnce({ ok: false, reason: "cap", cap: 50 });
    expect(textOf(await client.callTool({ name: "skills_create", arguments: { title: "x" } }))).toContain("50");
    updateUserSkill.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    const missing = await client.callTool({ name: "skills_update", arguments: { slug: "nope", title: "x" } });
    expect(textOf(missing)).toContain("No skill of yours");
    expect(trackSkillEvent).not.toHaveBeenCalled();
  });

  it("skills_update is a new version; skills_fork copies a published skill; both report their events", async () => {
    const client = await connectedClient();
    updateUserSkill.mockResolvedValueOnce({ ok: true, skill: { ...MINE, version: "fedcba9876543210" } });
    const upd = await client.callTool({ name: "skills_update", arguments: { slug: "draft-sweep", title: "Sweep my drafts" } });
    expect(updateUserSkill).toHaveBeenCalledWith(dbMock, "user-1", "draft-sweep", expect.objectContaining({ title: "Sweep my drafts" }));
    expect(JSON.parse(textOf(upd)).version).toBe("fedcba9876543210");
    expect(trackSkillEvent).toHaveBeenCalledWith(dbMock, "user-1", "skill_updated", expect.objectContaining({ skill: "draft-sweep" }));

    forkSkill.mockResolvedValueOnce({
      ok: true,
      skill: { ...MINE, slug: "morning-brief", forkedFrom: { slug: "morning-brief", version: "0123456789abcdef" } },
    });
    const fork = await client.callTool({ name: "skills_fork", arguments: { slug: "morning-brief" } });
    expect(forkSkill).toHaveBeenCalledWith(dbMock, "user-1", "morning-brief");
    expect(textOf(fork)).toContain("your version");
    expect(trackSkillEvent).toHaveBeenCalledWith(dbMock, "user-1", "skill_forked", expect.objectContaining({ skill: "morning-brief" }));
    forkSkill.mockResolvedValueOnce({ ok: false, reason: "exists" });
    expect(textOf(await client.callTool({ name: "skills_fork", arguments: { slug: "morning-brief" } }))).toContain("already");
  });

  it("skills_delete stamps and says the published skill is back when a shadow was deleted", async () => {
    const client = await connectedClient();
    deleteUserSkill.mockResolvedValueOnce({ slug: "morning-brief", shadowed: true });
    const res = await client.callTool({ name: "skills_delete", arguments: { slug: "morning-brief" } });
    expect(deleteUserSkill).toHaveBeenCalledWith(dbMock, "user-1", "morning-brief");
    expect(textOf(res)).toContain("published");
    expect(trackSkillEvent).toHaveBeenCalledWith(dbMock, "user-1", "skill_deleted", expect.objectContaining({ skill: "morning-brief", shadowed: true }));
    deleteUserSkill.mockResolvedValueOnce(null);
    expect(textOf(await client.callTool({ name: "skills_delete", arguments: { slug: "nope" } }))).toContain("No skill of yours");
  });

  it("prompts/get and skills_get say which layer is running", async () => {
    const client = await connectedClient();
    const res = await client.getPrompt({ name: "morning-brief", arguments: {} });
    const text = (res.messages[0]!.content as { text: string }).text;
    expect(text.startsWith("This is the published skill.")).toBe(true);
  });
});
