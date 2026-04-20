import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { usageEvents } from "@datatorag-mcp/db";
import { withRateLimit } from "@/lib/with-rate-limit";

export const dynamic = "force-dynamic";

export const GET = withRateLimit(async (userId) => {
  const rows = await db
    .select({
      id: usageEvents.id,
      toolName: usageEvents.toolName,
      connector: usageEvents.connector,
      status: usageEvents.status,
      latencyMs: usageEvents.latencyMs,
      createdAt: usageEvents.createdAt,
    })
    .from(usageEvents)
    .where(eq(usageEvents.userId, userId))
    .orderBy(desc(usageEvents.createdAt))
    .limit(50);

  return NextResponse.json({ events: rows });
});
