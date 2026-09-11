import { NextResponse } from "next/server";
import { withRoute } from "@/lib/with-route";
import { ownsRunId } from "@/gateway/playground/run-ownership";
import { requestStop } from "@/gateway/playground/run-registry";

export const dynamic = "force-dynamic";

/**
 * The user's Stop (SCRUM-258).
 *
 * Records a stop request for a run the caller owns; the agent's step
 * processor honours it before the next model call. The run id carries its
 * owner in an HMAC, so ownership is a pure check with no storage read, and
 * a run id that is not the caller's answers exactly as a made-up one does:
 * not found, never forbidden, so the endpoint cannot confirm that someone
 * else's run exists.
 *
 * Idempotent: stopping a run twice, or one that already ended, records the
 * same request and changes nothing else.
 */
export const POST = withRoute(async (userId, request) => {
  const body = (await request.json().catch(() => null)) as { runId?: unknown } | null;
  const runId = typeof body?.runId === "string" && body.runId !== "" ? body.runId : null;
  if (!runId) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  if (!ownsRunId(userId, runId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  requestStop(runId);
  return NextResponse.json({ stopping: true });
});
