import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUserId } from "@/lib/session";
import { getAllSkills, servicesFor } from "@/lib/skills";
import { loadConnectionsView } from "@/gateway/connections-view";
import { listSchedulesForUser } from "@/gateway/skills/schedules";
import { SkillsClient } from "./skills-client";

export const dynamic = "force-dynamic";

/**
 * The skills route in the dashboard (SCRUM-223).
 *
 * ONE CATALOGUE. This page reads the same collection the public /skills pages
 * read, `src/lib/skills.ts`, and copies nothing: a skill exists here exactly
 * when it exists there. What this page adds is the reader's own state: which
 * of the services each skill needs this user has connected, loaded
 * server-side with the same loader the agent page uses, so the Run buttons
 * are honest on first paint.
 *
 * Session checked here for the same reason every other dashboard route
 * checks it: the middleware gates on the cookie's presence, not its validity.
 */
export default async function DashboardSkillsPage() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/auth/login");

  const connections = await loadConnectionsView(db, userId);
  const connected = new Set<string>();
  for (const a of connections.accounts) connected.add(a.connectorType);
  for (const c of connections.connections) connected.add(c.service);

  const skills = (await getAllSkills(userId)).map((skill) => ({
    slug: skill.slug,
    layer: skill.layer,
    forkedFrom: skill.forkedFrom,
    title: skill.title,
    situation: skill.situation,
    produces: skill.produces,
    services: servicesFor(skill),
  }));

  // The user's schedules and their history (SCRUM-225), loaded server-side
  // so the Schedules section is honest on first paint too.
  const schedules = await listSchedulesForUser(db, userId);

  return <SkillsClient connected={[...connected]} skills={skills} schedules={schedules} />;
}
