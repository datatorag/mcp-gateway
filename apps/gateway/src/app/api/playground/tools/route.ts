import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { withRoute } from "@/lib/with-route";
import { tools, mcpServers } from "@datatorag-mcp/db";
import { SERVICE_PLUGIN_MAP } from "@/gateway/service-token";

// GET /api/playground/tools?service=google-workspace
export const GET = withRoute(async (_userId, request) => {
  const service = request.nextUrl.searchParams.get("service");
  if (!service) {
    return NextResponse.json(
      { error: "Missing service parameter" },
      { status: 400 }
    );
  }

  const slug = SERVICE_PLUGIN_MAP[service];
  if (!slug) {
    return NextResponse.json(
      { error: `Unknown service: ${service}` },
      { status: 400 }
    );
  }

  const rows = await db
    .select({
      name: tools.name,
      namespacedName: tools.namespacedName,
      description: tools.description,
      inputSchemaJson: tools.inputSchemaJson,
    })
    .from(tools)
    .innerJoin(mcpServers, eq(tools.mcpServerId, mcpServers.id))
    .where(eq(mcpServers.slug, slug))
    .orderBy(tools.name);

  return NextResponse.json({ tools: rows });
});
