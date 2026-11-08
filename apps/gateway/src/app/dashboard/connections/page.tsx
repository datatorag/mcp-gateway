import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/session";
import { ConnectionsClient } from "./connections-client";

export const dynamic = "force-dynamic";

/**
 * The connection card list (SCRUM-482). This route used to be a bare redirect
 * to `/dashboard`, forwarding its query string, because the cards lived on the
 * home; the home is now the connect-your-client page and the cards live here.
 * The connect flow's fallback leg (`/dashboard/connections?error=…`, and a
 * partial grant's `?connected=…&partial=…`) therefore lands on the cards
 * directly.
 *
 * It renders, so it resolves the session itself: `proxy.ts` gates
 * `/dashboard/*` on the cookie being present, not valid.
 */
export default async function ConnectionsPage() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/auth/login");
  return <ConnectionsClient />;
}
