import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withRoute } from "@/lib/with-route";
import { mcpServers, tools } from "@datatorag-mcp/db";

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
    .leftJoin(tools, eq(tools.mcpServerId, mcpServers.id))
    .groupBy(mcpServers.id)
    .orderBy(mcpServers.createdAt);

  return NextResponse.json({ servers });
});
