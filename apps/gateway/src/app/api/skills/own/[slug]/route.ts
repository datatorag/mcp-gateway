import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withRoute } from "@/lib/with-route";
import { EVENTS } from "@/lib/analytics";
import { servicesFor } from "@/lib/skill-links";
import { getSkillBySlug } from "@/lib/skills";
import { deleteUserSkill, findForViewer, updateUserSkill } from "@/gateway/skills/catalogue-store";
import { trackSkillEvent } from "@/gateway/track";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

/* Thin named functions over `withRoute`, for the reason the thread route
 * gives: a route with params needs a required context argument at build
 * time, which the shared wrapper's optional one does not satisfy directly. */

/** One 404 for a foreign, a published, and an unknown slug alike. */
const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });
const SLUG = /^[a-z0-9-]{1,80}$/;

/** GET: the user's own skill with its editable fields, for the editor. A
 * published skill is not editable and answers not found here; fork it. */
const getHandler = withRoute<Ctx>(async (userId, _request, ctx) => {
  const { slug } = await ctx.params;
  if (!SLUG.test(slug)) return notFound();
  const skill = await findForViewer(db, userId, slug);
  if (!skill || skill.layer !== "yours") return notFound();
  return NextResponse.json({
    skill: {
      slug: skill.slug,
      layer: skill.layer,
      version: skill.version,
      forkedFrom: skill.forkedFrom,
      title: skill.title,
      situation: skill.situation,
      produces: skill.produces,
      tools: skill.tools,
      accounts: skill.accounts,
      source: skill.skillSource,
    },
  });
});

/** PATCH: a new immutable version (SCRUM-226). */
const patchHandler = withRoute<Ctx>(async (userId, request, ctx) => {
  const { slug } = await ctx.params;
  if (!SLUG.test(slug)) return notFound();
  const body = await request.json().catch(() => null);
  const result = await updateUserSkill(db, userId, slug, body ?? {});
  if (!result.ok) {
    if (result.reason === "invalid") {
      return NextResponse.json({ error: "invalid", field: result.field, message: result.error }, { status: 400 });
    }
    if (result.reason === "not_found") return notFound();
    return NextResponse.json({ error: result.reason }, { status: 409 });
  }
  void trackSkillEvent(db, userId, EVENTS.SKILL_UPDATED, { skill: result.skill.slug, via: "dashboard" });
  return NextResponse.json({ skill: result.skill });
});

/** DELETE: stamp the current row. Answers with the published skill that
 * shows through again when a shadow was deleted, so the page can swap the
 * card without a second round trip. */
const deleteHandler = withRoute<Ctx>(async (userId, _request, ctx) => {
  const { slug } = await ctx.params;
  if (!SLUG.test(slug)) return notFound();
  const deleted = await deleteUserSkill(db, userId, slug);
  if (!deleted) return notFound();
  void trackSkillEvent(db, userId, EVENTS.SKILL_DELETED, {
    skill: deleted.slug,
    via: "dashboard",
    shadowed: deleted.shadowed,
  });
  const published = deleted.shadowed ? await getSkillBySlug(slug, null) : null;
  return NextResponse.json({
    slug: deleted.slug,
    shadowed: deleted.shadowed,
    published: published
      ? {
          slug: published.slug,
          title: published.title,
          situation: published.situation,
          produces: published.produces,
          services: servicesFor(published),
          layer: "published",
          forkedFrom: null,
        }
      : null,
  });
});

export function GET(request: NextRequest, ctx: Ctx) {
  return getHandler(request, ctx);
}

export function PATCH(request: NextRequest, ctx: Ctx) {
  return patchHandler(request, ctx);
}

export function DELETE(request: NextRequest, ctx: Ctx) {
  return deleteHandler(request, ctx);
}
