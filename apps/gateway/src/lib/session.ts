import { cookies } from "next/headers";
import { eq, and } from "drizzle-orm";
import { db } from "./db";
import { oauthAccessTokens } from "@datatorag-mcp/db";
import { liveTokenConditions } from "./token-liveness";

/**
 * Get the authenticated user ID from the session cookie.
 * Returns null if not authenticated.
 */
export async function getSessionUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("dtrmcp_session")?.value;
  if (!sessionToken) return null;

  const [token] = await db
    .select({ userId: oauthAccessTokens.userId })
    .from(oauthAccessTokens)
    .where(
      and(
        eq(oauthAccessTokens.token, sessionToken),
        ...liveTokenConditions()
      )
    )
    .limit(1);

  return token?.userId ?? null;
}
