import { NextResponse } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { usageEvents } from "@datatorag-mcp/db";
import { withRateLimit } from "@/lib/with-rate-limit";

export const dynamic = "force-dynamic";

export const GET = withRateLimit(async (userId) => {
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const rows = await db
    .select({
      total: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where ${usageEvents.status} = 'user_error')::int`,
      p95: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${usageEvents.latencyMs}), 0)::int`,
    })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, userId),
        gte(usageEvents.createdAt, startOfMonth)
      )
    );

  const r = rows[0] ?? { total: 0, errors: 0, p95: 0 };
  const total = r.total ?? 0;
  const errors = r.errors ?? 0;

  return NextResponse.json({
    totalCalls: total,
    successRate: total > 0 ? (total - errors) / total : 1,
    p95LatencyMs: r.p95 ?? 0,
    periodStart: startOfMonth.toISOString(),
  });
});
