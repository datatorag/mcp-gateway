import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { mcpServers, tools } from "@datatorag-mcp/db";
import { publiclyListedTool } from "@/gateway/gws-run-access";
import { ADMIN_AUDIENCE_PLUGIN_SLUGS } from "@/app/dashboard/connections/service-registry";

/**
 * The public pages' reads of the tools table, in one place so each carries
 * the same filter: a tool on PUBLICLY_UNLISTED_TOOLS (gws_run, SCRUM-419)
 * exists in the registry but is never advertised or counted in public.
 */

/** Whether a plugin may have a public page (`/tools/<slug>`, the sitemap).
 * Not one whose service only admins are offered (SCRUM-454): its row is
 * active so admins can use it, and that alone must not advertise it. */
export function isPublicServerSlug(slug: string): boolean {
  return !ADMIN_AUDIENCE_PLUGIN_SLUGS.includes(slug);
}

/** Tools on active servers, as the home and pricing pages state the count. */
export async function publicToolCount(db: Database): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(${tools.id})::int` })
    .from(tools)
    .innerJoin(mcpServers, eq(tools.mcpServerId, mcpServers.id))
    .where(and(eq(mcpServers.status, "active"), publiclyListedTool()));
  return row?.count ?? 0;
}

/** One server's tools as /tools/<slug> lists them. */
export async function publicServerTools(db: Database, serverId: string) {
  return db
    .select()
    .from(tools)
    .where(and(eq(tools.mcpServerId, serverId), publiclyListedTool()));
}
