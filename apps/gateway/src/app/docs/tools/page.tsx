import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { loadAllTools, type ToolGroup } from "@/lib/all-tools";
import { markdownUrl } from "@/lib/markdown-copies";
import { SITE_NAME, SITE_URL, breadcrumbNode, collectionPageNode } from "@/lib/site-schema";
import { SOCIAL_OPEN_GRAPH, SOCIAL_TWITTER } from "@/lib/social-card";
import { JsonLd } from "@/components/json-ld";
import { DocsCta } from "../cta";
import { ALL_TOOLS_DESCRIPTION, ALL_TOOLS_PATH, ALL_TOOLS_SEARCH_TITLE, ALL_TOOLS_TITLE } from "./copy";

// Request-time, like the per-connector tool pages: the list is read from the
// registry, and the build has no database to read it from.
export const dynamic = "force-dynamic";

const PAGE_URL = `${SITE_URL}${ALL_TOOLS_PATH}`;

export const metadata: Metadata = {
  title: ALL_TOOLS_SEARCH_TITLE,
  description: ALL_TOOLS_DESCRIPTION,
  alternates: { canonical: PAGE_URL, types: { "text/markdown": markdownUrl(ALL_TOOLS_PATH) } },
  openGraph: {
    ...SOCIAL_OPEN_GRAPH,
    title: ALL_TOOLS_SEARCH_TITLE,
    description: ALL_TOOLS_DESCRIPTION,
    type: "website",
    url: PAGE_URL,
  },
  twitter: { ...SOCIAL_TWITTER, title: ALL_TOOLS_SEARCH_TITLE, description: ALL_TOOLS_DESCRIPTION },
};

/** The groups, or null when the registry cannot be read. The page still
 * renders then, and says so, instead of answering an error. */
async function readGroups(): Promise<ToolGroup[] | null> {
  try {
    return await loadAllTools(db);
  } catch (err) {
    console.warn("[docs/tools] tool list read failed", err instanceof Error ? err.message : err);
    return null;
  }
}

const linkClass = "font-medium text-primary hover:underline";

export default async function AllToolsPage() {
  const groups = await readGroups();
  const total = groups?.reduce((n, g) => n + g.tools.length, 0) ?? 0;

  return (
    <div>
      {/* No date: the list is read from the registry on every request. */}
      <JsonLd
        nodes={[
          collectionPageNode({ name: ALL_TOOLS_TITLE, description: ALL_TOOLS_DESCRIPTION, url: PAGE_URL }),
          breadcrumbNode([
            { name: SITE_NAME, url: SITE_URL },
            { name: "Docs", url: `${SITE_URL}/docs` },
            { name: ALL_TOOLS_TITLE, url: PAGE_URL },
          ]),
        ]}
      />
      <h1 className="font-display text-2xl font-bold text-foreground">{ALL_TOOLS_TITLE}</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Every tool the DataToRAG MCP server serves to a signed-in user, grouped by connector. The list is read from
        the server&apos;s tool registry when this page loads, so it is the list your client gets.
      </p>

      <div className="prose mt-8">
        <p>
          Your client is served a connector&apos;s tools once you connect that account, and the built-in tools from
          the start. An MCP client can also read this list without signing in: a <code>tools/list</code> request to{" "}
          <code>https://datatorag.com/mcp</code> with no token is answered with every tool on this page, each with
          its full description and input schema. Calling a tool needs a sign-in.
        </p>
      </div>

      {groups === null ? (
        <p className="mt-8 rounded-xl border border-border bg-secondary/50 p-5 text-sm text-muted-foreground">
          The tool list could not be read just now. Reload the page in a minute, or ask the server itself with a{" "}
          <code className="font-mono text-xs text-primary">tools/list</code> request.
        </p>
      ) : (
        <>
          <p className="mt-6 text-sm text-muted-foreground">
            {total} tools in {groups.length} groups:{" "}
            {groups.map((g, i) => (
              <span key={g.key}>
                {i > 0 && ", "}
                <a href={`#${g.key}`} className={linkClass}>
                  {g.title}
                </a>{" "}
                ({g.tools.length})
              </span>
            ))}
            .
          </p>

          {groups.map((group) => (
            <section key={group.key} id={group.key} className="mt-10 scroll-mt-28">
              <h2 className="font-display text-lg font-bold text-foreground">
                <a href={`#${group.key}`}>{group.title}</a>
              </h2>
              {(group.docsHref || group.toolsHref) && (
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {group.docsHref && (
                    <Link href={group.docsHref} className={linkClass}>
                      {group.title} docs
                    </Link>
                  )}
                  {group.docsHref && group.toolsHref && " and "}
                  {group.toolsHref && (
                    <Link href={group.toolsHref} className={linkClass}>
                      every parameter of each tool
                    </Link>
                  )}
                  .
                </p>
              )}
              <ul className="mt-4 space-y-3">
                {group.tools.map((tool) => (
                  <li key={tool.name}>
                    <code className="font-mono text-sm font-medium text-primary">{tool.name}</code>
                    {tool.summary && (
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{tool.summary}</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}

      <DocsCta variant="inline" />
    </div>
  );
}
