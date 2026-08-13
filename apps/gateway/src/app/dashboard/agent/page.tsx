import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/session";
import { AgentClient } from "./agent-client";

export const dynamic = "force-dynamic";

/** `?welcome=1` is set by the post-login redirect - for every login, not just
 * a new user's - and is the only way this page can tell "landed here" from
 * "navigated here".
 *
 * `?signup=1` rides along on the signup landing only, so the pair of params
 * says WHICH login this was, and that is what `landed_from` carries into the
 * event. It is read HERE, server-side, rather than in the client: the signup
 * conversion effect deletes that param from the URL on mount, so a client-side
 * read would be racing a strip that is meant to happen.
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
  searchParams: Promise<{ welcome?: string; signup?: string }>;
}) {
  const userId = await getSessionUserId();
  if (!userId) redirect("/auth/login");
  const { welcome, signup } = await searchParams;
  return (
    <AgentClient
      isDefaultView={welcome === "1"}
      landedFrom={signup === "1" ? "signup" : "login"}
    />
  );
}
