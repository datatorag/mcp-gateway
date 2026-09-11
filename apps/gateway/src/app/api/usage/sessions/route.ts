import { NextResponse } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentRunUsage } from "@datatorag-mcp/db";
import { withRoute } from "@/lib/with-route";
import { parseUsageRange } from "@/gateway/usage/ranges";

export const dynamic = "force-dynamic";

/** What each session (thread) cost over the period (SCRUM-257): a sum over
 * the thread's runs, newest session first. */
export const GET = withRoute(async (userId, req) => {
  const { range, start } = parseUsageRange(req);

  const rows = await db
    .select({
      threadId: agentRunUsage.threadId,
      runs: sql<number>`count(*)::int`,
      steps: sql<number>`coalesce(sum(${agentRunUsage.steps}), 0)::int`,
      weightedTokens: sql<number>`coalesce(sum(${agentRunUsage.weightedTokens}), 0)::int`,
      // A null cost (an unpriced run) drops out of the sum; the run count
      // still includes it.
      costUsd: sql<string | null>`sum(${agentRunUsage.costUsd})`,
      lastAt: sql<Date>`max(${agentRunUsage.startedAt})`,
      skills: sql<string[]>`coalesce(array_agg(distinct ${agentRunUsage.skill}) filter (where ${agentRunUsage.skill} is not null), '{}')`,
    })
    .from(agentRunUsage)
    .where(and(eq(agentRunUsage.userId, userId), gte(agentRunUsage.startedAt, start)))
    .groupBy(agentRunUsage.threadId)
    .orderBy(sql`max(${agentRunUsage.startedAt}) desc`)
    .limit(100);

  const sessions = rows.map((r) => ({
    ...r,
    costUsd: r.costUsd === null || r.costUsd === undefined ? null : Number(r.costUsd),
    skills: Array.isArray(r.skills) ? r.skills : [],
  }));

  return NextResponse.json({ range, sessions });
});
