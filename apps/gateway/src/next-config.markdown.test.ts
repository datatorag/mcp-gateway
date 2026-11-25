/**
 * The Markdown addresses, end to end short of a socket: every address
 * `/llms.txt` lists, and the copy of every docs page and use case, is sent
 * by the config's rewrites to a route handler that answers it as Markdown.
 *
 * The rewrites are matched with the matcher the framework itself uses, so a
 * source pattern that does not mean what it looks like fails here.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";

/* The registry read behind the all-tools copy, as rows; `fail` makes the
   read throw and `rows` can be emptied. */
const registry = vi.hoisted(() => ({
  fail: false,
  rows: [
    { namespacedName: "gws-mcp__gmail_search", description: "Search mail. Returns ids.", serverSlug: "gws-mcp" },
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

const { default: nextConfig, MARKDOWN_REWRITES } = await import("../next.config");
const { getAllDocs } = await import("./lib/docs");
const { getAllUseCases } = await import("./lib/use-cases");
const { docMarkdown, llmsTxt, useCaseMarkdown } = await import("./lib/markdown-copies");

const SRC = join(__dirname);

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Response | Promise<Response>;

/** The route handlers under `app/md/`, by the address each answers. Static
 * segments first, as the framework resolves them. */
const ROUTES: { pattern: string; file: string; load: () => Promise<{ GET: Handler; dynamic?: string }> }[] = [
  { pattern: "/md/docs", file: "app/md/docs/route.ts", load: () => import("./app/md/docs/route") as never },
  { pattern: "/md/docs/tools", file: "app/md/docs/tools/route.ts", load: () => import("./app/md/docs/tools/route") as never },
  { pattern: "/md/docs/:slug", file: "app/md/docs/[slug]/route.ts", load: () => import("./app/md/docs/[slug]/route") as never },
  { pattern: "/md/use-cases/:slug", file: "app/md/use-cases/[slug]/route.ts", load: () => import("./app/md/use-cases/[slug]/route") as never },
];

/** Where the config sends a path, or the path itself when no rewrite takes it. */
function rewritten(pathname: string): string {
  for (const rule of MARKDOWN_REWRITES) {
    const params = getPathMatch(rule.source, { strict: true })(pathname);
    if (params) return rule.destination.replace(/:(\w+)/g, (_m, name: string) => String(params[name]));
  }
  return pathname;
}

/** Fetch a public address the way the app would answer it. */
async function get(pathname: string): Promise<Response> {
  const destination = rewritten(pathname);
  for (const route of ROUTES) {
    const params = getPathMatch(route.pattern, { strict: true })(destination);
    if (!params) continue;
    const { GET } = await route.load();
    return GET(new Request(`https://datatorag.com${pathname}`), { params: Promise.resolve(params as Record<string, string>) });
  }
  return new Response("no handler", { status: 404 });
}

describe("the Markdown rewrites", () => {
  it("are what the config returns, checked before any page", async () => {
    const rewrites = await nextConfig.rewrites!();
    expect(rewrites).toMatchObject({ beforeFiles: MARKDOWN_REWRITES });
  });

  it("send each address to its handler, and leave the pages alone", () => {
    expect(rewritten("/docs.md")).toBe("/md/docs");
    expect(rewritten("/docs/gmail.md")).toBe("/md/docs/gmail");
    expect(rewritten("/docs/getting-started.md")).toBe("/md/docs/getting-started");
    expect(rewritten("/docs/tools.md")).toBe("/md/docs/tools");
    expect(rewritten("/use-cases/morning-brief-across-every-inbox.md")).toBe("/md/use-cases/morning-brief-across-every-inbox");
    for (const page of ["/docs", "/docs/gmail", "/docs/tools", "/use-cases/a-b", "/docs/gmail.md/x", "/docs/a/b.md", "/blog/x.md"]) {
      expect(rewritten(page), page).toBe(page);
    }
  });

  it("every destination is a route handler that exists", () => {
    for (const route of ROUTES) expect(existsSync(join(SRC, route.file)), route.file).toBe(true);
    for (const rule of MARKDOWN_REWRITES) {
      expect(ROUTES.map((r) => r.pattern), rule.source).toContain(rule.destination);
    }
  });
});

describe("the Markdown addresses", () => {
  const listed = [...llmsTxt().matchAll(/\]\(https:\/\/datatorag\.com(\/[^)]+\.md)\)/g)].map((m) => m[1]);

  it("/llms.txt answers as text, with the list", async () => {
    const { GET } = await import("./app/llms.txt/route");
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    // The list itself may be indexed; only the copies ask not to be.
    expect(res.headers.get("x-robots-tag")).toBeNull();
    expect(await res.text()).toBe(llmsTxt());
  });

  it("every address /llms.txt lists resolves to a copy", async () => {
    registry.fail = false;
    expect(listed.length).toBe(getAllDocs().length + getAllUseCases().length + 2);
    for (const pathname of listed) {
      const res = await get(pathname);
      expect(res.status, pathname).toBe(200);
      expect(res.headers.get("content-type"), pathname).toBe("text/markdown; charset=utf-8");
      expect(res.headers.get("x-robots-tag"), pathname).toBe("noindex");
      expect((await res.text()).startsWith("# "), pathname).toBe(true);
    }
  });

  it("a copy exists for every docs page and every use case, and is the record's own", async () => {
    for (const doc of getAllDocs()) {
      const res = await get(`/docs/${doc.slug}.md`);
      expect(res.status, doc.slug).toBe(200);
      expect(await res.text(), doc.slug).toBe(docMarkdown(doc));
    }
    for (const useCase of getAllUseCases()) {
      const res = await get(`/use-cases/${useCase.slug}.md`);
      expect(res.status, useCase.slug).toBe(200);
      expect(await res.text(), useCase.slug).toBe(useCaseMarkdown(useCase));
    }
  });

  it("an address that names no page answers 404, not another page's copy", async () => {
    for (const pathname of ["/docs/no-such-page.md", "/use-cases/no-such-case.md"]) {
      const res = await get(pathname);
      expect(res.status, pathname).toBe(404);
      expect(res.headers.get("x-robots-tag"), pathname).toBe("noindex");
    }
  });

  it("the all-tools copy is read per request and never names an admin-only connector's tool", async () => {
    registry.fail = false;
    const route = await import("./app/md/docs/tools/route");
    expect(route.dynamic).toBe("force-dynamic");
    const text = await (await get("/docs/tools.md")).text();
    expect(text).toContain("- `gws-mcp__gmail_search`: Search mail.");
    expect(text).not.toMatch(/slack/i);
  });

  it("the all-tools copy answers 503 with a short text when the list cannot be read, never an empty list", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      registry.fail = true;
      const failed = await get("/docs/tools.md");
      expect(failed.status).toBe(503);
      expect(failed.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(failed.headers.get("retry-after")).toBe("60");
      expect(await failed.text()).toBe("The tool list could not be read just now. Try again in a minute.\n");

      // A read that answers no connector tool is the same failure: the
      // built-ins come from the code and prove nothing was read.
      registry.fail = false;
      const rows = registry.rows.splice(0);
      try {
        expect((await get("/docs/tools.md")).status).toBe(503);
      } finally {
        registry.rows.push(...rows);
      }
    } finally {
      warn.mockRestore();
    }
  });
});

describe("the pages advertise their copies", () => {
  it("a docs page and a use case page name their Markdown copy, and stay the canonical address", async () => {
    vi.doMock("posthog-js", () => ({ default: { capture: vi.fn() } }));
    vi.doMock("@/components/navbar", () => ({ Navbar: () => null }));
    const docPage = await import("./app/docs/[slug]/page");
    const doc = await docPage.generateMetadata({ params: Promise.resolve({ slug: "gmail" }) });
    expect(doc.alternates).toEqual({
      canonical: "https://datatorag.com/docs/gmail",
      types: { "text/markdown": "https://datatorag.com/docs/gmail.md" },
    });
    const useCase = getAllUseCases()[0];
    const useCasePage = await import("./app/use-cases/[slug]/page");
    const meta = await useCasePage.generateMetadata({ params: Promise.resolve({ slug: useCase.slug }) });
    expect(meta.alternates).toEqual({
      canonical: `https://datatorag.com/use-cases/${useCase.slug}`,
      types: { "text/markdown": `https://datatorag.com/use-cases/${useCase.slug}.md` },
    });
    const tools = await import("./app/docs/tools/page");
    expect(tools.metadata.alternates).toEqual({
      canonical: "https://datatorag.com/docs/tools",
      types: { "text/markdown": "https://datatorag.com/docs/tools.md" },
    });
  });
});
