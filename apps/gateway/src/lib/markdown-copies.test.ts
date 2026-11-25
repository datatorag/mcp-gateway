import { describe, expect, it } from "vitest";
import { docUrl, getAllDocs, getDocsSequence, type DocPage } from "./docs";
import {
  absoluteLinks,
  allToolsMarkdown,
  docMarkdown,
  docsIndexMarkdown,
  docsSections,
  llmsTxt,
  relativeLinksIn,
  useCaseMarkdown,
} from "./markdown-copies";
import { MCP_CLIENTS } from "./mcp-clients";
import { getAllUseCases } from "./use-cases";

/* The Markdown copies of the docs pages and the use cases, and `/llms.txt`,
   which lists them. Each is built from the record its HTML page renders, so
   these rules read the real content. */

const docs = getAllDocs();
const useCases = getAllUseCases();

/** Services offered to admins only. No public page names one. */
const ADMIN_ONLY = /\b(slack|brevo|posthog)\b/i;

const copies: [string, string][] = [
  ["/llms.txt", llmsTxt()],
  ["/docs.md", docsIndexMarkdown()],
  ...docs.map((d): [string, string] => [`/docs/${d.slug}.md`, docMarkdown(d)]),
  ...useCases.map((u): [string, string] => [`/use-cases/${u.slug}.md`, useCaseMarkdown(u)]),
];

describe("every Markdown copy", () => {
  it("covers every docs page and every use case", () => {
    // Guards the guard: an empty collection would pass everything below.
    expect(docs.length).toBeGreaterThan(10);
    expect(useCases.length).toBeGreaterThan(0);
    expect(copies.length).toBe(docs.length + useCases.length + 2);
  });

  it.each(copies)("%s holds no unfilled value", (_path, text) => {
    expect(text).not.toMatch(/\{\{|\}\}/);
  });

  it.each(copies)("%s holds no site-relative link", (_path, text) => {
    expect(relativeLinksIn(text)).toEqual([]);
  });

  it.each(copies)("%s names no admin-only service", (_path, text) => {
    expect(text.match(ADMIN_ONLY)).toBeNull();
  });

  it.each(copies)("%s ends with one newline and has no run of blank lines", (_path, text) => {
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
    expect(text).not.toMatch(/\n{3,}/);
  });

  it("the rules can go red", () => {
    expect(relativeLinksIn("See [Gmail](/docs/gmail) and [above](#limits).")).toEqual(["](/docs/gmail)", "](#limits)"]);
    expect(relativeLinksIn('<a href="/pricing">x</a> <img src="/docs/a.png">')).toEqual(['href="/pricing"', 'src="/docs/a.png"']);
    expect(relativeLinksIn("[ref]: /docs/gmail")).toEqual(["[ref]: /docs/gmail"]);
    expect(relativeLinksIn("[x](https://datatorag.com/docs/gmail) [y](//cdn.example/x)")).toEqual([]);
    expect(ADMIN_ONLY.test("Post it to Slack")).toBe(true);
  });
});

describe("links in a copy", () => {
  const page = "https://datatorag.com/docs/gmail";

  it("become absolute, and a link to a section becomes that section of the page", () => {
    expect(absoluteLinks("See [Drive](/docs/drive#upload), ![shot](/docs/a.png), and [above](#limits).", page)).toBe(
      "See [Drive](https://datatorag.com/docs/drive#upload), ![shot](https://datatorag.com/docs/a.png), and [above](https://datatorag.com/docs/gmail#limits)."
    );
    expect(absoluteLinks('<a href="/pricing">x</a> <img src="/a.png">', page)).toBe(
      '<a href="https://datatorag.com/pricing">x</a> <img src="https://datatorag.com/a.png">'
    );
    expect(absoluteLinks("[ref]: /docs/gmail", page)).toBe("[ref]: https://datatorag.com/docs/gmail");
  });

  it("are left alone when already absolute, or not ours", () => {
    const text = '[a](https://example.com/x) [b](//cdn.example/x) [c](mailto:a@example.com) <img src="cid:chart.png">';
    expect(absoluteLinks(text, page)).toBe(text);
  });

  it("are left as written inside a code block", () => {
    const text = "```\n[x](/docs/gmail)\n```\n[y](/docs/drive)";
    expect(absoluteLinks(text, page)).toBe("```\n[x](/docs/gmail)\n```\n[y](https://datatorag.com/docs/drive)");
    expect(relativeLinksIn(text)).toEqual(["](/docs/drive)"]);
  });
});

describe("a docs page's Markdown copy", () => {
  it.each(docs.map((d) => [d.slug, d] as const))("%s: its title, description, date, address, body, and questions", (_slug, doc: DocPage) => {
    const text = docMarkdown(doc);
    const lines = text.split("\n");
    expect(lines[0]).toBe(`# ${doc.title}`);
    expect(text.match(/^# /gm)).toHaveLength(1);
    expect(lines[2]).toBe(doc.description);
    expect(text).toContain(`Updated: ${doc.updated}  \nSource: ${docUrl(doc.slug)}\n`);
    // Every section of the page is in the copy, under the same words.
    const headings = doc.content.match(/^#{2,3} .*$/gm) ?? [];
    expect(headings.length).toBeGreaterThan(0);
    for (const heading of headings) expect(text).toContain(`\n${heading}\n`);
    // The questions, each once, after the body.
    expect(text.includes("\n## Frequently asked questions\n")).toBe(doc.faqs.length > 0);
    for (const faq of doc.faqs) expect(text.split(`\n### ${faq.q}\n`)).toHaveLength(2);
    // Nothing that renders nothing.
    expect(text).not.toContain("<!--");
    expect(text).not.toContain("<iframe");
  });

  it("writes the client steps where the page shows its picker, from the one list of clients", () => {
    const text = docMarkdown(docs.find((d) => d.slug === "getting-started")!);
    for (const client of MCP_CLIENTS) expect(text).toContain(`- **${client.label}.** ${client.step}`);
    expect(text).toContain("  claude mcp add --transport http datatorag https://datatorag.com/mcp");
    expect(text).toMatch(/\[Video: [^\]]+\]\(https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]+\)/);
  });
});

describe("a use case's Markdown copy", () => {
  it.each(useCases.map((u) => [u.slug, u] as const))("%s: the task, the outcome, the prompt, every step with its tool, and the result", (_slug, u) => {
    const text = useCaseMarkdown(u);
    expect(text.split("\n")[0]).toBe(`# ${u.title}`);
    expect(text).toContain(u.outcome);
    expect(text).toContain(`Updated: ${u.date}  \nSource: https://datatorag.com/use-cases/${u.slug}\n`);
    expect(text).toContain(`> ${u.prompt.split("\n")[0]}`);
    u.steps.forEach((step, i) => expect(text).toContain(`${i + 1}. ${step.label} (\`${step.tool}\`)`));
    expect(text).toContain(u.answer);
    const cells = u.result.kind === "table" ? [...u.result.columns, ...u.result.rows.flat()] : u.result.lines;
    for (const value of cells) expect(text).toContain(value.replace(/\|/g, "\\|"));
    if (u.result.kind === "created") expect(text).toContain(`**${u.result.what}: ${u.result.title}**`);
    // Its services' docs, each one a docs page that exists.
    const linked = [...text.matchAll(/\]\(https:\/\/datatorag\.com\/docs\/([a-z-]+)\.md\)/g)].map((m) => m[1]);
    expect(linked.length).toBe(u.services.length);
    for (const slug of linked) expect(docs.map((d) => d.slug)).toContain(slug);
  });

  it("draws a table result as a table", () => {
    const table = useCases.find((u) => u.result.kind === "table");
    if (!table || table.result.kind !== "table") return;
    expect(useCaseMarkdown(table)).toContain(`| ${table.result.columns.join(" | ")} |\n| ${table.result.columns.map(() => "---").join(" | ")} |`);
  });
});

describe("the all-tools page's Markdown copy", () => {
  it("lists each group's tools under its name, with absolute links", () => {
    const text = allToolsMarkdown([
      { key: "gws-mcp", title: "Google Workspace", toolsHref: "/tools/gws-mcp", docsHref: "/docs/google-workspace", tools: [{ name: "gws-mcp__gmail_search", summary: "Search mail." }] },
      { key: "built-in", title: "Built-in tools", toolsHref: null, docsHref: null, tools: [{ name: "echo", summary: "" }] },
    ]);
    expect(text).toContain("# All tools\n");
    expect(text).toContain("2 tools in 2 groups.");
    expect(text).toContain(
      "## Google Workspace\n\n[Google Workspace docs](https://datatorag.com/docs/google-workspace) and [every parameter of each tool](https://datatorag.com/tools/gws-mcp).\n\n- `gws-mcp__gmail_search`: Search mail.\n"
    );
    expect(text).toContain("## Built-in tools\n\n- `echo`\n");
    expect(relativeLinksIn(text)).toEqual([]);
  });
});

describe("/llms.txt", () => {
  const text = llmsTxt();
  const links = [...text.matchAll(/^- \[([^\]]+)\]\(([^)]+)\): (.+)$/gm)].map((m) => ({ title: m[1], url: m[2], description: m[3] }));

  it("has the shape: one H1 with the product's name, a summary in a blockquote, then sections of links", () => {
    const lines = text.split("\n");
    expect(lines[0]).toBe("# DataToRAG");
    expect(text.match(/^# /gm)).toHaveLength(1);
    expect(lines[2]).toMatch(/^> DataToRAG is a hosted MCP server at https:\/\/datatorag\.com\/mcp /);
    expect(lines[2]).toContain("Google Workspace, Atlassian, and Notion");
    const sections = text.match(/^## .+$/gm)!;
    expect(sections[0]).toBe("## Docs");
    expect(sections.at(-1)).toBe("## Use cases");
    // Every line under a section is a link with a description.
    const listed = text.slice(text.indexOf("## Docs")).split("\n").filter((l) => l !== "" && !l.startsWith("## "));
    expect(listed.length).toBe(links.length);
  });

  it("lists every docs page exactly once, at its Markdown address, in the sidebar's order", () => {
    const docLinks = links.filter((l) => /\/docs\/[^/]+\.md$/.test(l.url) && !l.url.endsWith("/docs/tools.md"));
    expect(docLinks.map((l) => l.url)).toEqual(getDocsSequence().map((d) => `https://datatorag.com/docs/${d.slug}.md`));
    for (const link of docLinks) {
      const doc = docs.find((d) => link.url === `https://datatorag.com/docs/${d.slug}.md`)!;
      expect(link.description).toBe(doc.description);
      expect(link.title.startsWith(doc.title)).toBe(true);
    }
  });

  it("groups the docs as the sidebar groups them", () => {
    const sections = docsSections();
    expect(sections.map((s) => s.heading)).toEqual(["General", "Google Workspace", "Atlassian", "Notion"]);
    expect(text.match(/^## .+$/gm)).toEqual(["## Docs", "## Docs: Google Workspace", "## Docs: Atlassian", "## Docs: Notion", "## Use cases"]);
    const gmail = docs.find((d) => d.slug === "gmail")!;
    expect(sections.find((s) => s.heading === "Google Workspace")!.entries.map((e) => e.path)).toContain(`/docs/${gmail.slug}`);
  });

  it("lists the docs index and the all-tools page", () => {
    expect(links.filter((l) => l.url === "https://datatorag.com/docs.md")).toHaveLength(1);
    expect(links.filter((l) => l.url === "https://datatorag.com/docs/tools.md")).toHaveLength(1);
  });

  it("lists every use case exactly once, with its description", () => {
    const listed = links.filter((l) => l.url.includes("/use-cases/"));
    expect(listed.map((l) => l.url).sort()).toEqual(useCases.map((u) => `https://datatorag.com/use-cases/${u.slug}.md`).sort());
    for (const u of useCases) expect(listed.find((l) => l.url.endsWith(`/${u.slug}.md`))).toMatchObject({ title: u.title, description: u.description });
  });

  it("lists nothing twice and nothing that is not a Markdown address of ours", () => {
    const urls = links.map((l) => l.url);
    expect(urls.filter((u, i) => urls.indexOf(u) !== i)).toEqual([]);
    expect(urls.filter((u) => !/^https:\/\/datatorag\.com\/[a-z0-9/-]+\.md$/.test(u))).toEqual([]);
    expect(urls.length).toBe(docs.length + useCases.length + 2);
  });

  it("the docs index copy lists the same docs pages", () => {
    const index = docsIndexMarkdown();
    for (const d of docs) expect(index.split(`(https://datatorag.com/docs/${d.slug}.md)`)).toHaveLength(2);
  });
});
