import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));
vi.mock("next/navigation", () => ({ usePathname: () => "/docs/tools" }));

/* The registry read, as rows. One of an admin-only connector and the
   unlisted tool are among them, as if a filter upstream had been lost. */
const registry = vi.hoisted(() => ({
  fail: false,
  rows: [
    { namespacedName: "atlassian-mcp__jira_search", description: "Search Jira issues. Takes JQL.", serverSlug: "atlassian-mcp" },
    { namespacedName: "gws-mcp__gmail_search", description: "Search mail. Returns ids.", serverSlug: "gws-mcp" },
    { namespacedName: "gws-mcp__gws_run", description: "Raw call.", serverSlug: "gws-mcp" },
    { namespacedName: "slack-mcp__slack_post_message", description: "Post a message.", serverSlug: "slack-mcp" },
  ],
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: () => (registry.fail ? Promise.reject(new Error("no database")) : Promise.resolve(registry.rows)),
          }),
        }),
      }),
    }),
  },
}));

const { default: AllToolsPage, metadata, dynamic } = await import("./page");
const { servedBuiltins } = await import("@/lib/all-tools");
const { ADMIN_ONLY_BUILTINS } = await import("@/gateway/admin-builtins");

describe("the all-tools page", () => {
  it("lists the served tools by connector, each with its summary, and the built-ins", async () => {
    registry.fail = false;
    const html = renderToStaticMarkup(await AllToolsPage());
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("gws-mcp__gmail_search");
    expect(html).toContain("Search mail.");
    expect(html).not.toContain("Returns ids.");
    expect(html).toContain('href="/tools/atlassian-mcp"');
    expect(html).toContain('href="/docs/google-workspace"');
    for (const t of servedBuiltins()) expect(html, t.definition.name).toContain(`>${t.definition.name}<`);
  });

  it("never shows an admin-only connector, the unlisted tool, or an admin built-in", async () => {
    registry.fail = false;
    const html = renderToStaticMarkup(await AllToolsPage());
    expect(html).not.toMatch(/slack|brevo|posthog/i);
    expect(html).not.toContain("gws_run");
    for (const name of ADMIN_ONLY_BUILTINS) expect(html).not.toContain(name);
  });

  it("still renders, and says the list is unavailable, when the registry cannot be read", async () => {
    registry.fail = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const html = renderToStaticMarkup(await AllToolsPage());
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("could not be read");
    expect(html).not.toContain("gws-mcp__gmail_search");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("is rendered per request, and describes itself", () => {
    expect(dynamic).toBe("force-dynamic");
    const description = metadata.description ?? "";
    expect(description.length).toBeGreaterThanOrEqual(120);
    expect(description.length).toBeLessThanOrEqual(160);
    expect(metadata.alternates?.canonical).toBe("https://datatorag.com/docs/tools");
  });
});
