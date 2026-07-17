import { eq } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { users } from "@datatorag-mcp/db";

// Per-process cache: emails effectively never change (Google OAuth identity),
// and the tool-call hot path shouldn't pay a SELECT per call.
const emailCache = new Map<string, string>();
const MAX_CACHE = 5000;

/**
 * Resolve a gateway user's email for PostHog identity stamping.
 * Never throws — analytics must not break the calling path.
 */
export async function resolveUserEmail(
  db: Database,
  userId: string
): Promise<string | null> {
  const hit = emailCache.get(userId);
  if (hit) return hit;
  try {
    const [row] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) return null;
    if (emailCache.size >= MAX_CACHE) emailCache.clear();
    emailCache.set(userId, row.email);
    return row.email;
  } catch (err) {
    console.warn(`[track] email lookup failed for user=${userId}`, err);
    return null;
  }
}

/**
 * Identity properties to spread into every server-side PostHog capture:
 * user_email makes the event attributable at event time (person-on-events
 * snapshots person properties at ingestion), and $set keeps the person
 * profile's email fresh even for users who never open the web dashboard.
 */
export function identityProps(
  email: string | null
): Record<string, unknown> {
  if (!email) return {};
  return { user_email: email, $set: { email } };
}
