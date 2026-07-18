import { eq } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { users } from "@datatorag-mcp/db";

export type UserIdentity = { email: string; activated: boolean };

// Per-process cache: emails effectively never change (Google OAuth identity),
// and activation flips exactly once — trackFirstToolCall marks it via
// markUserActivated, so the tool-call hot path stops issuing queries for
// settled state after the first call per user per process.
const cache = new Map<string, UserIdentity>();
const MAX_CACHE = 5000;

/**
 * Resolve a gateway user's email + activation state for analytics.
 * Never throws — analytics must not break the calling path.
 */
export async function resolveUserIdentity(
  db: Database,
  userId: string
): Promise<UserIdentity | null> {
  const hit = cache.get(userId);
  if (hit) return hit;
  try {
    const [row] = await db
      .select({ email: users.email, firstToolCallAt: users.firstToolCallAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) return null;
    if (cache.size >= MAX_CACHE) {
      // Evict the oldest entry (Map preserves insertion order) rather than
      // flushing everything and triggering a re-query storm.
      cache.delete(cache.keys().next().value!);
    }
    const identity: UserIdentity = {
      email: row.email,
      activated: row.firstToolCallAt != null,
    };
    cache.set(userId, identity);
    return identity;
  } catch (err) {
    console.warn(`[track] identity lookup failed for user=${userId}`, err);
    return null;
  }
}

export async function resolveUserEmail(
  db: Database,
  userId: string
): Promise<string | null> {
  return (await resolveUserIdentity(db, userId))?.email ?? null;
}

/**
 * Mark a user as activated in the cache after a milestone claim attempt —
 * once the claim UPDATE has run, the DB value is definitely non-null
 * (either we set it or someone already had), so later calls can skip it.
 */
export function markUserActivated(userId: string): void {
  const hit = cache.get(userId);
  if (hit) hit.activated = true;
}

export function clearUserIdentityCache(): void {
  cache.clear();
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
