import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withRoute } from "@/lib/with-route";
import { EVENTS } from "@/lib/analytics";
import { createSchedule, listSchedulesForUser, validateScheduleInput } from "@/gateway/skills/schedules";
import { trackSkillEvent } from "@/gateway/track";

export const dynamic = "force-dynamic";

/** GET /api/skills/schedules: the session user's schedules with history (SCRUM-225). */
export const GET = withRoute(async (userId) => {
  const schedules = await listSchedulesForUser(db, userId);
  return NextResponse.json({ schedules });
});

/** POST /api/skills/schedules: create one. Validated here, refused by the
 * module for a skill the user cannot run, and each refusal is its own status
 * so the client says the true thing. */
export const POST = withRoute(async (userId, request) => {
  const body = await request.json().catch(() => null);
  const parsed = validateScheduleInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: "Bad request", field: parsed.error }, { status: 400 });
  }
  const result = await createSchedule(db, userId, parsed.value);
  if (!result.ok) {
    if (result.reason === "unknown_skill") {
      return NextResponse.json({ error: "unknown_skill" }, { status: 404 });
    }
    if (result.reason === "not_connected") {
      return NextResponse.json({ error: "not_connected", missing: result.missing }, { status: 409 });
    }
    return NextResponse.json({ error: "exists" }, { status: 409 });
  }
  void trackSkillEvent(db, userId, EVENTS.SKILL_SCHEDULED, {
    skill: parsed.value.slug,
    cadence: parsed.value.cadence,
    hour: parsed.value.hour,
    schedule_id: result.schedule.id,
  });
  return NextResponse.json({ schedule: result.schedule }, { status: 201 });
});
