import { redirect } from "next/navigation";
import { connectionsForwardPath } from "@/gateway/post-connect-destination";

/** THE ONE DASHBOARD ROUTE WITHOUT A SESSION CHECK, and deliberately so.
 *
 * Every other route under `/dashboard` resolves the session itself, because
 * `proxy.ts` gates the prefix on the session cookie being PRESENT rather than
 * valid. This one renders nothing at all: it exists only to send an old URL to
 * the dashboard, and `/dashboard` does check. Adding a session lookup here
 * would buy an identical outcome, one hop later, at the cost of a cookie read
 * and a database round trip on a pure redirect.
 *
 * Named rather than left to be rediscovered. An unexplained gap in a set that
 * is otherwise uniform reads as an oversight, and the next person to audit
 * this either "fixes" it or has to work out why it is here.
 */
export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // SCRUM-149: forward the query string. This redirect used to drop it, which
  // silently swallowed every connect outcome landing on the fallback leg — a
  // refused connect rendered as nothing at all.
  redirect(connectionsForwardPath(await searchParams));
}
