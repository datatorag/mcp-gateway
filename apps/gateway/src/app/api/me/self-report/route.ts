import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withRoute } from "@/lib/with-route";
import { recordSelfReport } from "@/gateway/self-report";

/**
 * POST /api/me/self-report: the signed-in user answered or skipped "How did
 * you find DataToRAG?" (SCRUM-480). Body `{ answer: string }` or
 * `{ skipped: true }`. Only the caller's own row, and only a prompt that was
 * shown and not yet settled; a second post settles nothing and says so.
 */
export const POST = withRoute(async (userId, request) => {
  const body = (await request.json().catch(() => null)) as { answer?: unknown; skipped?: unknown } | null;
  const recorded = await recordSelfReport(db, userId, {
    answer: typeof body?.answer === "string" ? body.answer : null,
    skipped: body?.skipped === true,
  });
  return NextResponse.json({ recorded });
});
