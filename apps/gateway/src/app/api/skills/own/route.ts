import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withRoute } from "@/lib/with-route";
import { EVENTS } from "@/lib/analytics";
import { createUserSkill } from "@/gateway/skills/catalogue-store";
import { trackSkillEvent } from "@/gateway/track";

export const dynamic = "force-dynamic";

/** POST /api/skills/own: a new skill of the session user's (SCRUM-226).
 * The same function the `skills_create` built-in calls; each refusal is
 * its own status so the editor says the true thing. */
export const POST = withRoute(async (userId, request) => {
  const body = await request.json().catch(() => null);
  const result = await createUserSkill(db, userId, body ?? {});
  if (!result.ok) {
    if (result.reason === "invalid") {
      return NextResponse.json({ error: "invalid", field: result.field, message: result.error }, { status: 400 });
    }
    if (result.reason === "cap") {
      return NextResponse.json({ error: "cap", cap: result.cap }, { status: 409 });
    }
    return NextResponse.json({ error: result.reason }, { status: 409 });
  }
  void trackSkillEvent(db, userId, EVENTS.SKILL_CREATED, { skill: result.skill.slug, via: "dashboard" });
  return NextResponse.json({ skill: result.skill }, { status: 201 });
});
