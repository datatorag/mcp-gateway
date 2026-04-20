import { NextResponse } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { usageEvents } from "@datatorag-mcp/db";
import { withRateLimit } from "@/lib/with-rate-limit";
import { parseUsageRange } from "@/gateway/usage/ranges";

export const dynamic = "force-dynamic";

export const GET = withRateLimit(async (userId, req) => {
  const { range, truncExpr, start, bucket } = parseUsageRange(req);

  const rows = await db
    .select({
      bucket: sql<string>`${truncExpr}::text`,
      connector: usageEvents.connector,
      calls: sql<number>`count(*)::int`,
    })
    .from(usageEvents)
    .where(
      and(eq(usageEvents.userId, userId), gte(usageEvents.createdAt, start))
    )
    .groupBy(truncExpr, usageEvents.connector)
    .orderBy(truncExpr);

  return NextResponse.json({ range, bucket, points: rows });
});
