import { NextResponse, type NextRequest } from "next/server";
import { withAdminRoute } from "@/lib/with-admin-route";
import { db } from "@/lib/db";
import { getPool } from "@/gateway/runner-pool";
import { startTestRun } from "@/gateway/tests/execute";
import { listRuns } from "@/gateway/tests/read";
import { parseScope } from "@/gateway/tests/scope";

/** Start a run, or list the recent ones (SCRUM-303). */

export const GET = withAdminRoute(async () => {
  return NextResponse.json({ runs: await listRuns(db) });
}, { logContext: "[api] admin tests runs list" });

export const POST = withAdminRoute(async (userId, req: NextRequest) => {
  /* ONE PARSER, SHARED WITH THE MCP TOOL. Hand-rolled validation here and
   * in the tool disagreed about which inputs were refusable, and each
   * defaulted to accepting what it had not anticipated, which turned a
   * narrowing request into a run of the whole suite four different ways. */
  /* A BODY THAT WAS SENT AND COULD NOT BE PARSED IS NOT AN ABSENT BODY.
   * `.json().catch(() => null)` made a truncated request the single most
   * permissive input there is: `{"case_ids":["A1"` became "run everything".
   * An empty body still means "no scope", which is how the UI asks for a
   * full run. */
  const text = await req.text().catch(() => "");
  let body: unknown = null;
  if (text.trim() !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "The request body is not valid JSON." }, { status: 400 });
    }
  }
  const parsed = parseScope(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const scope = parsed.scope;

  const started = await startTestRun({ db, pool: getPool(), userId, trigger: "ui", scope });
  if (!started.ok) {
    if (started.reason === "empty_scope") {
      // 400: the caller asked for something that matches no case. Refused
      // rather than run, because an empty run finishes with no failures.
      return NextResponse.json({ error: "That scope selects no cases." }, { status: 400 });
    }
    // 409, not 500: a second run is a state of the world, not a fault, and
    // the page needs the running id to link to it.
    return NextResponse.json(
      { error: "A run is already in progress.", run_id: started.runId },
      { status: 409 }
    );
  }
  return NextResponse.json({ run_id: started.runId, cases: started.cases }, { status: 202 });
}, { logContext: "[api] admin tests run start" });
