import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/session";
import { AgentClient } from "./agent-client";

export const dynamic = "force-dynamic";

/** `?welcome=1` is set by the post-login redirect for a new user, and is the
 * only way this page can tell "landed here" from "navigated here".
 *
 * THE SESSION CHECK IS NOT REDUNDANT WITH THE MIDDLEWARE. `proxy.ts` gates
 * `/dashboard/*` on the session cookie being PRESENT, not valid, so any
 * non-empty value walks past it and this route rendered its shell to anyone
 * holding a made-up cookie. No data leaked (every API behind it answers 401),
 * but this route is the one being promoted to the default post-login
 * destination, and the surface a new user lands on should not be the surface
 * with the weakest check.
 *
 * The class fix is the middleware validating the token so per-page checks can
 * be retired; it is tracked separately and does not gate this. Until then, a
 * route that matters checks for itself.
 *
 * Note for anyone verifying this page locally: a forged cookie no longer gets
 * you here, which was previously the easy way to render it without signing in.
 * That is the point of the change. Use a real session. */
export default async function AgentPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const userId = await getSessionUserId();
  if (!userId) redirect("/auth/login");
  const { welcome } = await searchParams;
  return <AgentClient isDefaultView={welcome === "1"} />;
}
