import { NextResponse, type NextRequest } from "next/server";
import { withAdminRoute } from "@/lib/with-admin-route";
import { db } from "@/lib/db";
import { getPool } from "@/gateway/runner-pool";
import { startTestRun } from "@/gateway/tests/execute";
import { listRuns } from "@/gateway/tests/read";

/** Start a run, or list the recent ones (SCRUM-303). */

export const GET = withAdminRoute(async () => {
  return NextResponse.json({ runs: await listRuns(db) });
}, { logContext: "[api] admin tests runs list" });

export const POST = withAdminRoute(async (userId, req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as { tier?: unknown; case_ids?: unknown };
  const tier = body.tier === 1 || body.tier === 2 ? body.tier : undefined;
  const caseIds = Array.isArray(body.case_ids)
    ? body.case_ids.filter((id): id is string => typeof id === "string")
    : undefined;

  if (tier !== undefined && caseIds && caseIds.length > 0) {
    return NextResponse.json({ error: "Pass tier or case_ids, not both." }, { status: 400 });
  }

  const scope: { tier?: 1 | 2; caseIds?: string[] } = {};
  if (tier) scope.tier = tier;
  if (caseIds?.length) scope.caseIds = caseIds;

  const started = await startTestRun({ db, pool: getPool(), userId, trigger: "ui", scope });
  if (!started.ok) {
    // 409, not 500: a second run is a state of the world, not a fault, and
    // the page needs the running id to link to it.
    return NextResponse.json(
      { error: "A run is already in progress.", run_id: started.runId },
      { status: 409 }
    );
  }
  return NextResponse.json({ run_id: started.runId, cases: started.cases }, { status: 202 });
}, { logContext: "[api] admin tests run start" });
