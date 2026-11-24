import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MCP_CLIENTS } from "./mcp-clients";
import { getAllPersonas } from "./personas";
import { buildSiteNav, type NavItem } from "./site-nav";

const GATEWAY = join(import.meta.dirname, "../..");
const nav = buildSiteNav(getAllPersonas());
const items = nav.groups.flatMap((g) => g.columns.flatMap((c) => c.items.map((item) => ({ group: g.id, item }))));

/** Whether a site path has a page: a route's own `page.tsx`, or a content
 * file behind one of the three dynamic routes the menu links into. */
function resolves(href: string): boolean {
  const path = href.split(/[?#]/)[0];
  if (existsSync(join(GATEWAY, "src/app", path, "page.tsx"))) return true;
  const content: [RegExp, string][] = [
    [/^\/docs\/([a-z0-9-]+)$/, "content/docs"],
    [/^\/blog\/([a-z0-9-]+)$/, "content/blog"],
    [/^\/skills\/for\/([a-z0-9-]+)$/, "content/personas"],
  ];
  return content.some(([shape, dir]) => {
    const slug = shape.exec(path)?.[1];
    return !!slug && existsSync(join(GATEWAY, dir, `${slug}.md`));
  });
}

describe("the site navigation's data", () => {
  it("is three groups, then Docs and Pricing", () => {
    expect(nav.groups.map((g) => g.label)).toEqual(["Product", "Solutions", "Resources"]);
    expect(nav.groups.map((g) => g.columns.map((c) => c.heading))).toEqual([
      ["Use", "Connect", "Trust"],
      ["For agents", "Built for"],
      ["Resources"],
    ]);
    expect(nav.links.map((l) => l.href)).toEqual(["/docs", "/pricing"]);
  });

  it("links only to pages that exist", () => {
    const dead = [...items.map((i) => i.item), ...nav.links]
      .filter((i) => !("external" in i && i.external))
      .filter((i) => !resolves(i.href))
      .map((i) => i.href);
    expect(dead).toEqual([]);
    // The check can fail: a path with no page does not resolve.
    expect(resolves("/no-such-page")).toBe(false);
    expect(resolves("/docs/no-such-doc")).toBe(false);
  });

  it("opens only the repository off the site", () => {
    const external = items.filter((i) => i.item.external).map((i) => i.item.href);
    expect(external).toEqual(["https://github.com/datatorag/mcp-gateway"]);
    for (const { item } of items) if (!item.external) expect(item.href.startsWith("/"), item.id).toBe(true);
  });

  it("no longer links to an anchor on the home page", () => {
    expect(items.filter((i) => i.item.href.includes("#"))).toEqual([]);
  });

  it("lists the agents the Add to your agent block lists, each opening that page on its own client", () => {
    const column = nav.groups[1].columns[0];
    expect(column.items.map((i) => i.label)).toEqual(MCP_CLIENTS.map((c) => c.label));
    expect(column.items.map((i) => i.href)).toEqual(MCP_CLIENTS.map((c) => `/add-to-your-agent?client=${c.id}`));
  });

  it("lists every persona page with that page's own title and menu line, then all skills", () => {
    const personas = getAllPersonas();
    expect(personas.length).toBeGreaterThan(0);
    const column = nav.groups[1].columns[1].items;
    expect(column.slice(0, -1).map((i: NavItem) => [i.href, i.label, i.description])).toEqual(
      personas.map((p) => [`/skills/for/${p.slug}`, p.title, p.menuLine])
    );
    expect(column.at(-1)?.href).toBe("/skills");
  });

  it("gives every item an id that is its own within its group, since the click event carries the pair", () => {
    for (const group of nav.groups) {
      const ids = group.columns.flatMap((c) => c.items.map((i) => i.id));
      expect(new Set(ids).size, group.id).toBe(ids.length);
    }
  });

  it("writes its copy by the house rules: no dashes, and agents are never called assistants", () => {
    const typed = readFileSync(join(import.meta.dirname, "site-nav.ts"), "utf8");
    const strings = [...typed.matchAll(/(?:label|description|heading): "([^"]*)"/g)].map((m) => m[1]);
    expect(strings.length).toBeGreaterThan(20);
    for (const text of strings) {
      expect(text, text).not.toMatch(/[\u2013\u2014]/);
      expect(text, text).not.toMatch(/assistant/i);
    }
  });
});
