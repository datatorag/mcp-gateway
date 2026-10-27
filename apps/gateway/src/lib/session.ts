import { cookies } from "next/headers";
import { db } from "./db";
import { liveWebSessionUserId } from "./web-session";

/**
 * Get the authenticated user ID from the session cookie.
 * Returns null if not authenticated: no cookie, or one that is not a live web
 * session (see `liveWebSessionUserId`).
 */
export async function getSessionUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  return liveWebSessionUserId(db, cookieStore.get("dtrmcp_session")?.value);
}
