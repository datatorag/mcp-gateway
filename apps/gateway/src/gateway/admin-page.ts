import { notFound } from "next/navigation";
import type { Database } from "@datatorag-mcp/db";
import { db as defaultDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/session";
import { isAdmin } from "./admin";

/**
 * The guard for admin SERVER COMPONENTS (SCRUM-302). Throws Next's not-found,
 * which renders the app's own 404 — not an imitation of it, the same page a
 * URL with no route gets, because it is the same code path.
 *
 * It answers a SIGNED-IN NON-ADMIN. An anonymous visitor never reaches it:
 * `src/proxy.ts` bounces every `/dashboard/*` request without a session
 * cookie to login, and `/dashboard/admin` gets no exception. That is
 * deliberate, and it is the opposite of this design's first draft. Every
 * sibling dashboard path bounces, so a 404 here for an anonymous visitor
 * would be the one answer that differs, and that difference is what names the
 * path. The middleware is not changed at all.
 *
 * Returns the admin's user id, so a page need not repeat the session read.
 */
export async function requireAdminPage(db: Database = defaultDb): Promise<string> {
  const userId = await getSessionUserId();
  if (!userId) notFound();
  if (!(await isAdmin(db, userId))) notFound();
  return userId;
}
