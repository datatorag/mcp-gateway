import { NextResponse } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { usageEvents } from "@datatorag-mcp/db";
import { withRateLimit } from "@/lib/with-rate-limit";
import { parseUsageRange } from "@/gateway/usage/ranges";

export const dynamic = "force-dynamic";

export const GET = withRateLimit(async (userId, req) => {
  const { range, start } = parseUsageRange(req);

  const rows = await db
    .select({
      toolName: usageEvents.toolName,
      connector: usageEvents.connector,
      calls: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where ${usageEvents.status} = 'user_error')::int`,
      p50: sql<number>`coalesce(percentile_cont(0.5) within group (order by ${usageEvents.latencyMs}), 0)::int`,
      p95: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${usageEvents.latencyMs}), 0)::int`,
      avgSize: sql<number>`coalesce(avg(${usageEvents.responseSizeBytes}), 0)::int`,
    })
    .from(usageEvents)
    .where(
      and(eq(usageEvents.userId, userId), gte(usageEvents.createdAt, start))
    )
    .groupBy(usageEvents.toolName, usageEvents.connector)
    .orderBy(sql`count(*) desc`);

  return NextResponse.json({ range, tools: rows });
});
