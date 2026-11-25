import type { MetadataRoute } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { mcpServers } from "@datatorag-mcp/db";
import { getAllPosts, postModified } from "@/lib/blog";
import { getAllDocs } from "@/lib/docs";
import { getAllSkills } from "@/lib/skills";
import { getAllPersonas } from "@/lib/personas";
import { getAllUseCases } from "@/lib/use-cases";
import { isPublicServerSlug } from "@/lib/public-tools";
import { ALL_TOOLS_PATH } from "./docs/tools/copy";

// Request-time so the tools query runs against the live DB, not at build.
export const dynamic = "force-dynamic";

const BASE = "https://datatorag.com";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const allPosts = getAllPosts();
  // The blog index changes when a post is published or edited: the newest of
  // those days is its own.
  const newestPostDay = allPosts.map(postModified).sort().at(-1);
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: BASE, changeFrequency: "weekly", priority: 1 },
    {
      // The phrase-owning landing page. Priority 0.9 because it is the page
      // we most need found, and it is not linked from the nav.
      url: `${BASE}/hosted-google-workspace-mcp`,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${BASE}/blog`,
      ...(newestPostDay ? { lastModified: new Date(`${newestPostDay}T00:00:00`) } : {}),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    // The docs index, a page of its own, and the generated list of every
    // tool beside it. `/tools` alone only redirects there and is not listed.
    { url: `${BASE}/docs`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE}${ALL_TOOLS_PATH}`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${BASE}/skills`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE}/changelog`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${BASE}/status`, changeFrequency: "daily", priority: 0.5 },
    { url: `${BASE}/pricing`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/faq`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/add-to-your-agent`, changeFrequency: "monthly", priority: 0.7 },
    // /demo still serves (ad destinations, analytics history) but canonicalizes
    // to /contact, so only the canonical URL is listed here.
    { url: `${BASE}/contact`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/request-integration`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${BASE}/terms`, changeFrequency: "yearly", priority: 0.2 },
  ];

  const posts: MetadataRoute.Sitemap = allPosts.map((p) => ({
    url: `${BASE}/blog/${p.slug}`,
    lastModified: new Date(`${postModified(p)}T00:00:00`),
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  // Each docs page with the day its file last changed (content/docs-dates.json).
  // The docs index and the all-tools page above carry no date on purpose:
  // both are built from other sources, so no single day is theirs.
  const docs: MetadataRoute.Sitemap = getAllDocs().map((d) => ({
    url: `${BASE}/docs/${d.slug}`,
    ...(d.updated ? { lastModified: new Date(`${d.updated}T00:00:00`) } : {}),
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  const skills: MetadataRoute.Sitemap = (await getAllSkills()).map((s) => ({
    url: `${BASE}/skills/${s.slug}`,
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  // Personas are indexable routes on purpose: they exist so which audience
  // reads is answerable from traffic, and an unindexed page answers nothing.
  // Use cases (SCRUM-514): each with the date its record was last changed,
  // and the list with the newest of those.
  const allUseCases = getAllUseCases();
  const useCases: MetadataRoute.Sitemap = [
    ...(allUseCases.length > 0
      ? [
          {
            url: `${BASE}/use-cases`,
            lastModified: new Date(`${allUseCases.map((u) => u.date).sort().at(-1)}T00:00:00`),
            changeFrequency: "weekly" as const,
            priority: 0.8,
          },
        ]
      : []),
    ...allUseCases.map((u) => ({
      url: `${BASE}/use-cases/${u.slug}`,
      lastModified: new Date(`${u.date}T00:00:00`),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];

  const personas: MetadataRoute.Sitemap = getAllPersonas().map((p) => ({
    url: `${BASE}/skills/for/${p.slug}`,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  // Server/tool pages come from the DB; the sitemap must render even if
  // that query fails, so these are best-effort.
  let tools: MetadataRoute.Sitemap = [];
  try {
    const servers = await db
      .select({ slug: mcpServers.slug })
      .from(mcpServers)
      .where(eq(mcpServers.status, "active"));
    tools = servers.filter((s) => isPublicServerSlug(s.slug)).map((s) => ({
      url: `${BASE}/tools/${s.slug}`,
      changeFrequency: "monthly",
      priority: 0.5,
    }));
  } catch (err) {
    console.warn("[sitemap] tools query failed, omitting /tools URLs", err);
  }

  // `/r/<slug>` share links (src/lib/share-links.ts) are deliberately absent:
  // they are redirects, not content, and must not compete with their targets.
  // `sitemap.test.ts` pins this.
  return [...staticRoutes, ...posts, ...docs, ...skills, ...useCases, ...personas, ...tools];
}
