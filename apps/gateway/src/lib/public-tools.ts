import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { mcpServers, tools } from "@datatorag-mcp/db";
import { publiclyListedTool } from "@/gateway/gws-run-access";

/**
 * The public pages' reads of the tools table, in one place so each carries
 * the same filter: a tool on PUBLICLY_UNLISTED_TOOLS (gws_run, SCRUM-419)
 * exists in the registry but is never advertised or counted in public.
 */

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
