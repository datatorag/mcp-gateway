import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { join } from "node:path";
import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { marked } from "marked";
import { db } from "@/lib/db";
import { mcpServers, tools } from "@datatorag-mcp/db";
import { Navbar } from "@/components/navbar";
import { SERVER_LOGOS } from "@/components/server-logos";
import Link from "next/link";

interface Props {
  params: Promise<{ slug: string }>;
}

async function getReadmeHtml(
  slug: string,
  githubRepoOwner: string | null,
  githubRepoName: string | null
): Promise<string | null> {
  // Try reading from local plugin directory first
  try {
    const pluginDir = join(homedir(), ".datatorag", "plugins", slug);
    const content = await readFile(join(pluginDir, "README.md"), "utf-8");
    return marked.parse(content) as string;
  } catch {
    // Not available locally
  }

  // Fall back to GitHub API
  if (githubRepoOwner && githubRepoName) {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${githubRepoOwner}/${githubRepoName}/readme`,
        {
          headers: { Accept: "application/vnd.github.raw+json" },
          next: { revalidate: 3600 },
        }
      );
      if (res.ok) {
        const content = await res.text();
        return marked.parse(content) as string;
      }
    } catch {
      // GitHub API unavailable
    }
  }

  return null;
}

async function getServer(slug: string) {
  const [server] = await db
    .select()
    .from(mcpServers)
    .where(eq(mcpServers.slug, slug))
    .limit(1);

  if (!server || server.status !== "active") return null;

  const [serverTools, readmeHtml] = await Promise.all([
    db.select().from(tools).where(eq(tools.mcpServerId, server.id)),
    getReadmeHtml(slug, server.githubRepoOwner, server.githubRepoName),
  ]);

  return { server, tools: serverTools, readmeHtml };
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const data = await getServer(slug);
  if (!data) return { title: "Not Found" };

  return {
    title: `${data.server.name} | DataToRAG`,
    description: data.server.description ?? `Data source with ${data.tools.length} capabilities`,
    alternates: { canonical: `https://datatorag.com/tools/${slug}` },
  };
}

export default async function ToolDetailPage({ params }: Props) {
  const { slug } = await params;
  const data = await getServer(slug);

  if (!data) notFound();

  const { server, tools: serverTools, readmeHtml } = data;

  return (
    <>
      <Navbar />

      <main className="flex-1">
        <div className="mx-auto max-w-4xl px-6 pb-12 pt-28 sm:pb-16 sm:pt-32">
          {/* Header */}
          <div className="animate-fade-in-up">
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Back
            </Link>

            <div className="mt-6 flex items-start gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent p-2.5 font-display text-2xl font-bold text-accent-foreground">
                {SERVER_LOGOS[slug] ?? server.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h1 className="font-display text-2xl font-bold text-foreground">
                  {server.name}
                </h1>
                {server.description && (
                  <p className="mt-1.5 text-muted-foreground">
                    {server.description}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <span className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
                {serverTools.length} {serverTools.length === 1 ? "capability" : "capabilities"}
              </span>
              {server.licenseSpdx && (
                <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                  {server.licenseSpdx}
                </span>
              )}
              {server.githubRepoUrl && (
                <a
                  href={server.githubRepoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground transition-colors hover:bg-border"
                >
                  View Source ↗
                </a>
              )}
            </div>
          </div>

          {/* README */}
          {readmeHtml && (
            <div
              className="animate-fade-in-up mt-12 prose"
              style={{ animationDelay: "0.1s" }}
              dangerouslySetInnerHTML={{ __html: readmeHtml }}
            />
          )}

          {/* Capabilities */}
          <div className="animate-fade-in-up mt-12" style={{ animationDelay: readmeHtml ? "0.2s" : "0.1s" }}>
            <h2 className="font-display text-lg font-bold text-foreground">
              Capabilities
            </h2>

            <div className="mt-5 space-y-3">
              {serverTools.map((tool) => {
                const schema = tool.inputSchemaJson as Record<string, unknown> | null;
                const properties = (schema?.properties ?? {}) as Record<
                  string,
                  { type?: string; description?: string }
                >;

                return (
                  <div
                    key={tool.id}
                    className="rounded-2xl border border-border p-5"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <code className="font-mono text-sm font-medium text-primary">
                        {tool.namespacedName}
                      </code>
                    </div>
                    {tool.description && (
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        {tool.description}
                      </p>
                    )}
                    {Object.keys(properties).length > 0 && (
                      <div className="mt-4 rounded-xl bg-secondary/70 p-4">
                        <p className="text-xs font-medium text-foreground">
                          Parameters
                        </p>
                        <div className="mt-2 space-y-1.5">
                          {Object.entries(properties).map(([name, prop]) => (
                            <div key={name} className="flex items-baseline gap-2 text-sm">
                              <code className="font-mono text-xs text-primary">
                                {name}
                              </code>
                              {prop.type && (
                                <span className="text-xs text-muted-foreground">
                                  {prop.type}
                                </span>
                              )}
                              {prop.description && (
                                <span className="text-xs text-muted-foreground">
                                  / {prop.description}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Connect */}
          <div className="animate-fade-in-up mt-12" style={{ animationDelay: readmeHtml ? "0.3s" : "0.2s" }}>
            <h2 className="font-display text-lg font-bold text-foreground">
              Connect
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Add this to your MCP client config to access all integrations through the gateway.
            </p>
            <pre className="mt-4 overflow-x-auto rounded-2xl border border-border bg-[#1C1917] p-5 font-mono text-sm leading-relaxed text-[#E7E5E4]">
{`{
  "mcpServers": {
    "datatorag": {
      "url": "https://datatorag.com/mcp"
    }
  }
}`}
            </pre>
          </div>
        </div>
      </main>
    </>
  );
}
