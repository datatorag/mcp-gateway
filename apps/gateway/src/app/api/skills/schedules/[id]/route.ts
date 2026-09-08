import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withRoute } from "@/lib/with-route";
import { EVENTS } from "@/lib/analytics";
import { deleteSchedule, setSchedulePaused } from "@/gateway/skills/schedules";
import { trackSkillEvent } from "@/gateway/track";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/* Thin named functions over `withRoute`, for the reason the thread route
 * gives: a route with params needs a required context argument at build
 * time, which the shared wrapper's optional one does not satisfy directly. */

/** NOT FOUND for a foreign id and an unknown one alike; the module returns
 * one null for both, and this keeps that property at the wire. */
const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

/** A schedule id is a uuid; anything else is not found before the database
 * is asked, so a malformed id never surfaces as a generic error. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PATCH { paused: boolean }: one-click pause, explicit resume (SCRUM-225). */
const patchHandler = withRoute<Ctx>(async (userId, request, ctx) => {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return notFound();
  const body = (await request.json().catch(() => null)) as { paused?: unknown } | null;
  if (typeof body?.paused !== "boolean") {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const schedule = await setSchedulePaused(db, userId, id, body.paused);
  if (!schedule) return notFound();
  void trackSkillEvent(
    db,
    userId,
    body.paused ? EVENTS.SKILL_SCHEDULE_PAUSED : EVENTS.SKILL_SCHEDULE_RESUMED,
    {
      skill: schedule.skillSlug,
      schedule_id: id,
      ...(body.paused ? { by: "user", reason: "user" } : {}),
    }
  );
  return NextResponse.json({ schedule });
});

const deleteHandler = withRoute<Ctx>(async (userId, _request, ctx) => {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return notFound();
  const deleted = await deleteSchedule(db, userId, id);
  if (!deleted) return notFound();
  void trackSkillEvent(db, userId, EVENTS.SKILL_SCHEDULE_DELETED, {
    skill: deleted.skillSlug,
    schedule_id: id,
  });
  return NextResponse.json({ ok: true });
});

export function PATCH(request: NextRequest, ctx: Ctx) {
  return patchHandler(request, ctx);
}

export function DELETE(request: NextRequest, ctx: Ctx) {
  return deleteHandler(request, ctx);
}
