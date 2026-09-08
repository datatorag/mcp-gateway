import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withRoute } from "@/lib/with-route";
import { EVENTS } from "@/lib/analytics";
import { forkSkill } from "@/gateway/skills/catalogue-store";
import { trackSkillEvent } from "@/gateway/track";

export const dynamic = "force-dynamic";

const SLUG = /^[a-z0-9-]{1,80}$/;

/** POST /api/skills/fork { slug }: the published skill copied into the
 * session user's own, same slug, so it shadows the original for them
 * (SCRUM-226). The same function the `skills_fork` built-in calls. */
export const POST = withRoute(async (userId, request) => {
  const body = (await request.json().catch(() => null)) as { slug?: unknown } | null;
  const slug = typeof body?.slug === "string" ? body.slug : "";
  if (!SLUG.test(slug)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const result = await forkSkill(db, userId, slug);
  if (!result.ok) {
    if (result.reason === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (result.reason === "cap") return NextResponse.json({ error: "cap", cap: result.cap }, { status: 409 });
    return NextResponse.json({ error: result.reason }, { status: 409 });
  }
  void trackSkillEvent(db, userId, EVENTS.SKILL_FORKED, { skill: result.skill.slug, via: "dashboard" });
  return NextResponse.json({ skill: result.skill }, { status: 201 });
});
