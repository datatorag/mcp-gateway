import { describe, expect, it, vi } from "vitest";
import type { Database } from "@datatorag-mcp/db";
import { BUILT_IN_TOOLS, listedTools } from "@/gateway/mcp-server";
import { ADMIN_ONLY_BUILTINS } from "@/gateway/admin-builtins";
import { PUBLICLY_UNLISTED_TOOLS } from "@/gateway/gws-run-access";
import { ADMIN_AUDIENCE_PLUGIN_SLUGS } from "@/app/dashboard/connections/service-registry";
import { BUILT_IN_GROUP_KEY, groupServedTools, loadAllTools, servedBuiltins, toolSummary } from "./all-tools";

/* The all-tools page lists what an ordinary signed-in user is served once
   every public service is connected. These hold the grouping to the same
   rows and built-ins `tools/list` is shaped from, and keep the admin-only
   connectors and the unlisted tools off the page even when a row for one
   reaches the function. */

const row = (namespacedName: string, description = `${namespacedName} does a thing. More words.`) => ({
  namespacedName,
  description,
  schema: { type: "object" as const, properties: {} },
  requiredService: undefined,
  readOnlyHint: null,
  destructiveHint: null,
});

const PUBLIC_ROWS = [
  row("atlassian-mcp__jira_search"),
  row("gws-mcp__calendar_list_events"),
  row("gws-mcp__gmail_search"),
  row("notion-mcp__notion_search"),
];

const names = (groups: ReturnType<typeof groupServedTools>) => groups.flatMap((g) => g.tools.map((t) => t.name));

describe("the all-tools list", () => {
  it("is the served list: the same names tools/list is shaped from, each exactly once", () => {
    const served = listedTools(PUBLIC_ROWS, servedBuiltins()).map((t) => t.name);
    const listed = names(groupServedTools(PUBLIC_ROWS, servedBuiltins()));
    expect(served.length).toBeGreaterThan(PUBLIC_ROWS.length);
    expect([...listed].sort()).toEqual([...served].sort());
  });

  it("never lists an admin-only connector's tool or an unlisted tool, even when handed its row", () => {
    // Guards the guard: the lists this test leans on are not empty.
    expect(ADMIN_AUDIENCE_PLUGIN_SLUGS).toEqual(expect.arrayContaining(["slack-mcp", "brevo-mcp"]));
    expect(PUBLICLY_UNLISTED_TOOLS).toContain("gws-mcp__gws_run");

    const leaked = [
      ...PUBLIC_ROWS,
      ...ADMIN_AUDIENCE_PLUGIN_SLUGS.map((slug) => row(`${slug}__some_tool`)),
      ...PUBLICLY_UNLISTED_TOOLS.map((name) => row(name)),
    ];
    const groups = groupServedTools(leaked, BUILT_IN_TOOLS);
    const listed = names(groups);

    expect([...listed].sort()).toEqual(
      [...PUBLIC_ROWS.map((r) => r.namespacedName), ...servedBuiltins().map((t) => t.definition.name)].sort()
    );
    for (const slug of ADMIN_AUDIENCE_PLUGIN_SLUGS) {
      expect(groups.map((g) => g.key)).not.toContain(slug);
      expect(listed.filter((n) => n.startsWith(`${slug}__`))).toEqual([]);
    }
    expect(listed).not.toContain("gws-mcp__gws_run");
    for (const name of ADMIN_ONLY_BUILTINS) expect(listed).not.toContain(name);
  });

  it("groups by connector in the registry's order, names each group, and puts the built-ins last", () => {
    const groups = groupServedTools(PUBLIC_ROWS, servedBuiltins());
    expect(groups.map((g) => g.key)).toEqual(["gws-mcp", "atlassian-mcp", "notion-mcp", BUILT_IN_GROUP_KEY]);
    expect(groups.map((g) => g.title).slice(0, 3)).toEqual(["Google Workspace", "Atlassian", "Notion"]);
    expect(groups[0].tools.map((t) => t.name)).toEqual(["gws-mcp__calendar_list_events", "gws-mcp__gmail_search"]);
    expect(groups[0].toolsHref).toBe("/tools/gws-mcp");
    expect(groups[0].docsHref).toBe("/docs/google-workspace");
    expect(groups.at(-1)!.toolsHref).toBeNull();
  });

  it("keeps a plugin with no connector record, under its own slug", () => {
    const groups = groupServedTools([...PUBLIC_ROWS, row("other-mcp__do_it")], []);
    const other = groups.find((g) => g.key === "other-mcp");
    expect(other?.title).toBe("other-mcp");
    expect(other?.docsHref).toBeNull();
    expect(groups.find((g) => g.key === BUILT_IN_GROUP_KEY)).toBeUndefined();
  });

  it("serves the built-ins a signed-out tools/list is given: no audience, on the MCP surface", () => {
    const served = servedBuiltins().map((t) => t.definition.name);
    expect(served).toEqual(expect.arrayContaining(["connect", "list_connected_accounts", "skills_search"]));
    const entries = [
      { definition: { name: "open", description: "", inputSchema: {} } },
      { definition: { name: "admin", description: "", inputSchema: {} }, audience: "admin" as const },
      { definition: { name: "agent_only", description: "", inputSchema: {} }, surfaces: ["agent" as const] },
      { definition: { name: "mcp_only", description: "", inputSchema: {} }, surfaces: ["mcp" as const] },
    ];
    expect(servedBuiltins(entries).map((t) => t.definition.name)).toEqual(["open", "mcp_only"]);
  });

  it("reads the rows through the public registry read and nothing else", async () => {
    const where = vi.fn(() => ({ orderBy: () => Promise.resolve([{ namespacedName: "gws-mcp__gmail_search", description: "Search mail.", inputSchemaJson: null, readOnlyHint: true, destructiveHint: null, serverSlug: "gws-mcp" }]) }));
    const db = { select: () => ({ from: () => ({ innerJoin: () => ({ where }) }) }) } as unknown as Database;
    const groups = await loadAllTools(db);
    expect(where).toHaveBeenCalledTimes(1);
    expect(groups[0].tools).toEqual([{ name: "gws-mcp__gmail_search", summary: "Search mail." }]);
  });
});

describe("a tool's one-line summary", () => {
  it("is the first sentence of the first line", () => {
    expect(toolSummary("Search mail. Returns ids.\nSecond paragraph.")).toBe("Search mail.");
    expect(toolSummary("\n  Lists events (default: primary).  Then more.")).toBe("Lists events (default: primary).");
  });

  it("does not stop at an abbreviation, a version, or a file name", () => {
    expect(toolSummary("Reads a range, e.g. A1:B2, from a sheet. Next.")).toBe("Reads a range, e.g. A1:B2, from a sheet.");
    expect(toolSummary("Uploads report.pdf to v1.2 storage")).toBe("Uploads report.pdf to v1.2 storage");
  });

  it("is empty for an empty description", () => {
    expect(toolSummary("")).toBe("");
  });
});
