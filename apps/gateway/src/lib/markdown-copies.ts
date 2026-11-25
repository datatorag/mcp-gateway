import { DOCS_GLOSSARY, DOCS_GLOSSARY_HEADING, DOCS_INDEX_DESCRIPTION, DOCS_INDEX_HEADING, DOCS_INDEX_PATH } from "@/app/docs/copy";
import { ALL_TOOLS_DESCRIPTION, ALL_TOOLS_PATH, ALL_TOOLS_TITLE } from "@/app/docs/tools/copy";
import type { ToolGroup } from "./all-tools";
import { DOC_SETUP_MARKER, docUrl, getConnectorGroups, getTopLevelDocs, type DocPage } from "./docs";
import { DEFAULT_MCP_URL, MCP_CLIENTS, clientConfig } from "./mcp-clients";
import { PUBLIC_CLIENTS_TEXT, PUBLIC_CONNECTORS_TEXT } from "./public-integrations";
import { SITE_NAME, SITE_URL } from "./site-schema";
import { USE_CASE_SERVICES, getAllUseCases, useCasePassage, type UseCase } from "./use-cases";

/**
 * The site's pages as Markdown, for an agent that reads a page instead of
 * rendering it: `/llms.txt` (the list), and a copy of every docs page and
 * every use case at the page's own address plus `.md`.
 *
 * Nothing here is written twice. A docs page's copy is the same loaded
 * record the HTML page renders (`getAllDocs`: body with its values filled,
 * description, date, questions); a use case's copy is its record; the list
 * is the sidebar's reading order. So a copy cannot say something its page
 * does not.
 *
 * A copy stands alone: every link in it is absolute, because whoever reads
 * it has no page around it to resolve a path against.
 *
 * The addresses are routed by `MARKDOWN_REWRITES` in `next.config.ts` to
 * the route handlers under `app/md/`.
 */

/** The address of a page's Markdown copy: the page's own, plus `.md`. */
export const markdownPath = (pagePath: string): string => `${pagePath}.md`;
export const markdownUrl = (pagePath: string): string => `${SITE_URL}${markdownPath(pagePath)}`;

/** A copy is for reading by a program, and the page it copies is the one a
 * search result should show, so a copy asks not to be indexed. It is not
 * disallowed in robots.txt: a crawler refused the address could never read
 * this header. */
const COPY_HEADERS = { "X-Robots-Tag": "noindex" };

export function markdownResponse(body: string): Response {
  return new Response(body, { headers: { "Content-Type": "text/markdown; charset=utf-8", ...COPY_HEADERS } });
}

/** A short plain answer for a copy that cannot be made right now. */
export function unavailableResponse(message: string): Response {
  return new Response(`${message}\n`, {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "60", "Cache-Control": "no-store", ...COPY_HEADERS },
  });
}

export function notFoundResponse(): Response {
  return new Response("Not found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", ...COPY_HEADERS } });
}

/* ------------------------------------------------------------------ links */

const absolute = (target: string, pageUrl: string): string => (target === "#" ? `${pageUrl}#` : `${SITE_URL}/`);

/** One line with its site-relative links made absolute: markdown links and
 * images, reference definitions, and `href`/`src` in inline HTML. A link to
 * a section of the same page (`#section`) becomes that section on the HTML
 * page. A protocol-relative address (`//host`) is not ours and is left. */
function absoluteLine(line: string, pageUrl: string): string {
  return line
    .replace(/\]\((\/(?!\/)|#)/g, (_m, t: string) => `](${absolute(t, pageUrl)}`)
    .replace(/\b(href|src)="(\/(?!\/)|#)/g, (_m, name: string, t: string) => `${name}="${absolute(t, pageUrl)}`)
    .replace(/^(\s*\[[^\]]+\]:\s+)(\/(?!\/)|#)/, (_m, lead: string, t: string) => `${lead}${absolute(t, pageUrl)}`);
}

const FENCE = /^\s*(```|~~~)/;

/** `markdown` with every site-relative link made absolute. Lines inside a
 * fenced code block are an example, not a link, and are left as written. */
export function absoluteLinks(markdown: string, pageUrl: string): string {
  let fenced = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (FENCE.test(line)) {
        fenced = !fenced;
        return line;
      }
      return fenced ? line : absoluteLine(line, pageUrl);
    })
    .join("\n");
}

/** The site-relative links left in `markdown`, outside fenced code. Empty
 * for every copy; a test holds each one to it. */
export function relativeLinksIn(markdown: string): string[] {
  let fenced = false;
  return markdown.split("\n").flatMap((line) => {
    if (FENCE.test(line)) {
      fenced = !fenced;
      return [];
    }
    if (fenced) return [];
    return [...line.matchAll(/\]\((?:\/(?!\/)|#)[^)]*\)|\b(?:href|src)="(?:\/(?!\/)|#)[^"]*"|^\s*\[[^\]]+\]:\s+(?:\/(?!\/)|#)\S*/g)].map((m) => m[0]);
  });
}

/* -------------------------------------------------------------- docs page */

/** The client steps the HTML page shows as a picker, as a list: the same
 * clients, the same steps, and the same config strings, from the one list
 * every surface reads. */
function clientStepsMarkdown(): string {
  return MCP_CLIENTS.map((client) => {
    const config = clientConfig(client.id, DEFAULT_MCP_URL)
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n");
    const note = client.planNote ? ` ${client.planNote}` : "";
    return `- **${client.label}.** ${client.step}${note}\n\n  \`\`\`\n${config}\n  \`\`\``;
  }).join("\n\n");
}

const YOUTUBE_IFRAME = /<iframe\b[^>]*\ssrc="https:\/\/www\.youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{6,20})[^"]*"[^>]*>\s*<\/iframe>/gi;

/** A docs page's body as it reads without a browser: the setup marker
 * becomes the client steps, an embedded video becomes a link to it, and
 * comments (which render nothing on the page) are dropped. */
function docBodyMarkdown(doc: DocPage): string {
  return doc.content
    .replace(DOC_SETUP_MARKER, () => clientStepsMarkdown())
    .replace(YOUTUBE_IFRAME, (tag: string, id: string) => {
      const title = tag.match(/\stitle="([^"]*)"/i)?.[1] ?? "Video";
      return `[Video: ${title}](https://www.youtube.com/watch?v=${id})`;
    })
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const QUESTIONS_HEADING = "Frequently asked questions";

/** One docs page as Markdown: its title, its description, the day it was
 * last changed, where the page itself is, its body, and its questions. */
export function docMarkdown(doc: DocPage): string {
  const url = docUrl(doc.slug);
  const parts = [
    `# ${doc.title}`,
    doc.description,
    [doc.updated ? `Updated: ${doc.updated}` : null, `Source: ${url}`].filter(Boolean).join("  \n"),
    docBodyMarkdown(doc),
  ];
  if (doc.faqs.length > 0) {
    parts.push(`## ${QUESTIONS_HEADING}`, ...doc.faqs.flatMap((f) => [`### ${f.q}`, f.a.trim()]));
  }
  return `${absoluteLinks(parts.filter(Boolean).join("\n\n"), url)}\n`;
}

/* ------------------------------------------------------------ list of pages */

export interface CopyEntry {
  title: string;
  /** The page's own path, such as `/docs/gmail`. */
  path: string;
  description: string;
}

export interface CopySection {
  heading: string;
  entries: CopyEntry[];
}

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();
const docEntry = (doc: DocPage, title = doc.title): CopyEntry => ({ title, path: `/docs/${doc.slug}`, description: doc.description });

/** Every docs page once, grouped as the sidebar and the docs index group
 * them and in the same order: the general pages and the all-tools page,
 * then each connector's overview followed by its pages. */
export function docsSections(): CopySection[] {
  return [
    {
      heading: "General",
      entries: [...getTopLevelDocs().map((d) => docEntry(d)), { title: ALL_TOOLS_TITLE, path: ALL_TOOLS_PATH, description: ALL_TOOLS_DESCRIPTION }],
    },
    ...getConnectorGroups().map(({ connector, overview, pages }) => ({
      heading: connector.title,
      entries: [...(overview ? [docEntry(overview, `${overview.title} overview`)] : []), ...pages.map((d) => docEntry(d))],
    })),
  ];
}

export function useCaseEntries(): CopyEntry[] {
  return getAllUseCases().map((u) => ({ title: u.title, path: `/use-cases/${u.slug}`, description: u.description }));
}

/** One line of a list: the page's name, linked to its Markdown copy, and
 * its one-line description. */
const entryLine = (entry: CopyEntry): string =>
  `- [${oneLine(entry.title)}](${markdownUrl(entry.path)}): ${oneLine(entry.description)}`;

const sectionMarkdown = (section: CopySection, heading = section.heading): string =>
  [`## ${heading}`, section.entries.map(entryLine).join("\n")].join("\n\n");


/** The docs index as Markdown: every docs page with its description, then
 * the words the docs use, from the list the index renders as its glossary. */
export function docsIndexMarkdown(): string {
  const glossary = [`## ${DOCS_GLOSSARY_HEADING}`, DOCS_GLOSSARY.map((g) => `- **${g.term}**: ${oneLine(g.definition)}`).join("\n")].join("\n\n");
  return `${[
    `# ${DOCS_INDEX_HEADING}`,
    DOCS_INDEX_DESCRIPTION,
    `Source: ${SITE_URL}${DOCS_INDEX_PATH}`,
    ...docsSections().map((s) => sectionMarkdown(s)),
    ...(DOCS_GLOSSARY.length > 0 ? [glossary] : []),
  ].join("\n\n")}\n`;
}

/**
 * `/llms.txt`, in the shape llmstxt.org describes: the product's name, a
 * summary in a blockquote, then sections of links, each with a description.
 * Every docs page and every use case is listed once, at its Markdown
 * address.
 */
export function llmsTxt(): string {
  const [general, ...connectors] = docsSections();
  const docs: CopySection = {
    heading: "Docs",
    entries: [{ title: DOCS_INDEX_HEADING, path: DOCS_INDEX_PATH, description: DOCS_INDEX_DESCRIPTION }, ...general.entries],
  };
  return `${[
    `# ${SITE_NAME}`,
    `> ${SITE_NAME} is a hosted MCP server at ${DEFAULT_MCP_URL} that gives an agent tools for ${PUBLIC_CONNECTORS_TEXT}, on every account you connect. It works with ${PUBLIC_CLIENTS_TEXT}, and with any other MCP client.`,
    `Every link below is the Markdown copy of a page. Remove \`.md\` from an address for the page itself.`,
    sectionMarkdown(docs),
    ...connectors.map((s) => sectionMarkdown(s, `Docs: ${s.heading}`)),
    sectionMarkdown({ heading: "Use cases", entries: useCaseEntries() }),
  ].join("\n\n")}\n`;
}

/* -------------------------------------------------------------- all tools */

/** The all-tools page as Markdown, from the groups the page reads. */
export function allToolsMarkdown(groups: ToolGroup[]): string {
  const total = groups.reduce((n, g) => n + g.tools.length, 0);
  const sections = groups.map((group) => {
    const links = [
      group.docsHref ? `[${group.title} docs](${group.docsHref})` : null,
      group.toolsHref ? `[every parameter of each tool](${group.toolsHref})` : null,
    ].filter(Boolean);
    return [
      `## ${group.title}`,
      ...(links.length > 0 ? [`${links.join(" and ")}.`] : []),
      group.tools.map((tool) => `- \`${tool.name}\`${tool.summary ? `: ${oneLine(tool.summary)}` : ""}`).join("\n"),
    ].join("\n\n");
  });
  const url = `${SITE_URL}${ALL_TOOLS_PATH}`;
  const head = [`# ${ALL_TOOLS_TITLE}`, ALL_TOOLS_DESCRIPTION, `Source: ${url}`, `${total} tools in ${groups.length} groups.`,
    "An MCP client can read this list without signing in: a `tools/list` request to https://datatorag.com/mcp with no token is answered with every tool here, each with its full description and input schema. Calling a tool needs a sign-in.",
  ];
  return `${absoluteLinks([...head, ...sections].join("\n\n"), url)}\n`;
}

/* --------------------------------------------------------------- use case */

const cell = (text: string): string => oneLine(text).replace(/\|/g, "\\|");

function resultMarkdown(result: UseCase["result"]): string {
  if (result.kind === "table") {
    const row = (cells: string[]) => `| ${cells.map(cell).join(" | ")} |`;
    return [row(result.columns), row(result.columns.map(() => "---")), ...result.rows.map(row)].join("\n");
  }
  const lines = result.lines.map((line) => `- ${oneLine(line)}`).join("\n");
  return result.kind === "created" ? `**${result.what}: ${result.title}**\n\n${lines}` : lines;
}

/** One use case as Markdown, from the record its page is drawn from: the
 * task, the outcome, what to ask, each step with the tool it calls, what
 * comes back, and the docs of the services it uses. */
export function useCaseMarkdown(useCase: UseCase): string {
  const url = `${SITE_URL}/use-cases/${useCase.slug}`;
  const parts = [
    `# ${useCase.title}`,
    useCasePassage(useCase),
    `Updated: ${useCase.date}  \nSource: ${url}`,
    "## What to ask",
    useCase.prompt
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n"),
    "## What the agent does",
    useCase.steps.map((step, i) => `${i + 1}. ${oneLine(step.label)} (\`${step.tool}\`)`).join("\n"),
    "## What comes back",
    useCase.answer,
    resultMarkdown(useCase.result),
    "Sample content. Yours comes from your own accounts.",
    ...(useCase.skill ? ["## Try it", `There is a ready-made skill for this: ${SITE_URL}/skills/${useCase.skill}`] : []),
    "## The tools it uses",
    useCase.services.map((s) => `- [${USE_CASE_SERVICES[s].label} docs](${markdownUrl(`/docs/${USE_CASE_SERVICES[s].docs}`)})`).join("\n"),
  ];
  return `${parts.join("\n\n")}\n`;
}
