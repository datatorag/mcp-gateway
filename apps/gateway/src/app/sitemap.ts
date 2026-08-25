import type { MetadataRoute } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { mcpServers } from "@datatorag-mcp/db";
import { getAllPosts } from "@/lib/blog";
import { getAllDocs } from "@/lib/docs";
import { getAllSkills } from "@/lib/skills";
import { getAllPersonas } from "@/lib/personas";

// Request-time so the tools query runs against the live DB, not at build.
export const dynamic = "force-dynamic";

const BASE = "https://datatorag.com";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: BASE, changeFrequency: "weekly", priority: 1 },
    {
      // The phrase-owning landing page. Priority 0.9 because it is the page
      // we most need found, and it is not linked from the nav.
      url: `${BASE}/hosted-google-workspace-mcp`,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    { url: `${BASE}/blog`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE}/docs`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE}/skills`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE}/changelog`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${BASE}/pricing`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/faq`, changeFrequency: "monthly", priority: 0.6 },
    // /demo still serves (ad destinations, analytics history) but canonicalizes
    // to /contact, so only the canonical URL is listed here.
    { url: `${BASE}/contact`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${BASE}/terms`, changeFrequency: "yearly", priority: 0.2 },
  ];

  const posts: MetadataRoute.Sitemap = getAllPosts().map((p) => ({
    url: `${BASE}/blog/${p.slug}`,
    lastModified: new Date(`${p.updated ?? p.date}T00:00:00`),
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  const docs: MetadataRoute.Sitemap = getAllDocs().map((d) => ({
    url: `${BASE}/docs/${d.slug}`,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  const skills: MetadataRoute.Sitemap = getAllSkills().map((s) => ({
    url: `${BASE}/skills/${s.slug}`,
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  // Personas are indexable routes on purpose: they exist so which audience
  // reads is answerable from traffic, and an unindexed page answers nothing.
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
    tools = servers.map((s) => ({
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
  return [...staticRoutes, ...posts, ...docs, ...skills, ...personas, ...tools];
}
