import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/session";
import { DashboardClient } from "./dashboard-client";

export const dynamic = "force-dynamic";

/**
 * THE SESSION CHECK IS NOT REDUNDANT WITH THE MIDDLEWARE. `proxy.ts` gates
 * `/dashboard/*` on the session cookie being PRESENT, not valid, so any
 * non-empty value walked past it and this route rendered its shell to anyone.
 * Nothing behind it was reachable, every API answers 401, but rendering the
 * signed-in furniture to a stranger is not a property this route should have.
 *
 * THE ENUMERATED STATE, because a count from memory got this wrong twice.
 * There are seven routes under `/dashboard`: this one, `agent`, `mcp-config`,
 * `usage`, `usage/[tool]`, `connections/[service]` and `connections`. The
 * first six resolve the session before rendering anything. The seventh,
 * `connections/page.tsx`, deliberately does not, and says so in its own file:
 * it renders nothing and immediately redirects here, which does check.
 *
 * The list is spelled out rather than counted because "all N routes are
 * covered" is a claim about a set, and asserting one without listing it is how
 * two unchecked routes survived a review that believed there were four.
 *
 * The class fix is the middleware validating the token so these per-page
 * checks can all be retired together; it is tracked separately.
 */
export default async function DashboardPage() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/auth/login");
  return <DashboardClient />;
}
