import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withRoute } from "@/lib/with-route";
import { mcpServers, tools } from "@datatorag-mcp/db";
import { publiclyListedTool } from "@/gateway/gws-run-access";

// GET /api/servers — list all servers with tool counts (authenticated)
export const GET = withRoute(async () => {
  const servers = await db
    .select({
      slug: mcpServers.slug,
      name: mcpServers.name,
      description: mcpServers.description,
      status: mcpServers.status,
      toolCount: sql<number>`count(${tools.id})::int`,
    })
    .from(mcpServers)
    .leftJoin(tools, and(eq(tools.mcpServerId, mcpServers.id), publiclyListedTool()))
    .groupBy(mcpServers.id)
    .orderBy(mcpServers.createdAt);

  return NextResponse.json({ servers });
});
