import { NextResponse } from "next/server";
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentRunUsage } from "@datatorag-mcp/db";
import { withRoute } from "@/lib/with-route";
import { parseUsageRange } from "@/gateway/usage/ranges";

export const dynamic = "force-dynamic";

/** The caller's agent runs for the period, newest first, each priced, with
 * the period totals (SCRUM-257). A run whose model had no price row keeps a
 * null cost and is counted separately rather than as free. */
export const GET = withRoute(async (userId, req) => {
  const { range, start } = parseUsageRange(req);

  const rows = await db
    .select({
      runId: agentRunUsage.runId,
      threadId: agentRunUsage.threadId,
      skill: agentRunUsage.skill,
      model: agentRunUsage.model,
      steps: agentRunUsage.steps,
      inputTokens: agentRunUsage.inputTokens,
      cacheReadTokens: agentRunUsage.cacheReadTokens,
      cacheWriteTokens: agentRunUsage.cacheWriteTokens,
      outputTokens: agentRunUsage.outputTokens,
      reasoningTokens: agentRunUsage.reasoningTokens,
      weightedTokens: agentRunUsage.weightedTokens,
      costUsd: agentRunUsage.costUsd,
      startedAt: agentRunUsage.startedAt,
      endedAt: agentRunUsage.endedAt,
    })
    .from(agentRunUsage)
    .where(and(eq(agentRunUsage.userId, userId), gte(agentRunUsage.startedAt, start)))
    .orderBy(desc(agentRunUsage.startedAt))
    .limit(200);

  const runs = rows.map((r) => ({
    ...r,
    costUsd: r.costUsd === null || r.costUsd === undefined ? null : Number(r.costUsd),
  }));
  const totals = runs.reduce(
    (t, r) => ({
      runs: t.runs + 1,
      steps: t.steps + (r.steps ?? 0),
      weightedTokens: t.weightedTokens + (r.weightedTokens ?? 0),
      costUsd: t.costUsd + (r.costUsd ?? 0),
      unpricedRuns: t.unpricedRuns + (r.costUsd === null ? 1 : 0),
    }),
    { runs: 0, steps: 0, weightedTokens: 0, costUsd: 0, unpricedRuns: 0 }
  );

  return NextResponse.json({ range, runs, totals });
});
