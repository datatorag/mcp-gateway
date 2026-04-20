import { NextResponse } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { usageEvents } from "@datatorag-mcp/db";
import { withRateLimit } from "@/lib/with-rate-limit";

export const dynamic = "force-dynamic";
const RANGES = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 } as const;

export const GET = withRateLimit(async (userId, req) => {
  const url = new URL(req.url);
  const range = (url.searchParams.get("range") ?? "7d") as keyof typeof RANGES;
  const days = RANGES[range] ?? 7;
  const start = new Date(Date.now() - days * 24 * 3600_000);
  const bucket = days <= 1 ? "hour" : "day";

  const truncExpr =
    bucket === "hour"
      ? sql`date_trunc('hour', ${usageEvents.createdAt})`
      : sql`date_trunc('day', ${usageEvents.createdAt})`;

  const rows = await db
    .select({
      bucket: sql<string>`${truncExpr}::text`,
      connector: usageEvents.connector,
      calls: sql<number>`count(*)::int`,
    })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, userId), gte(usageEvents.createdAt, start)))
    .groupBy(truncExpr, usageEvents.connector)
    .orderBy(truncExpr);

  return NextResponse.json({ range, bucket, points: rows });
});
