import { eq } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { users } from "@datatorag-mcp/db";

/**
 * The role check (SCRUM-302), and the two guards built on it.
 *
 * `users.role` is the first authorization primitive in the schema. Before it,
 * the only "is this one of us" predicate was `capExempt` in usage/period.ts,
 * which reads the email domain — a metering heuristic whose own doc comment
 * says, at length, that it must never decide whether a caller may act on
 * someone else's data. This module is the thing that comment asked for.
 *
 * What the role grants: the admin pages, the admin JSON routes, and built-in
 * tools that declare `audience: "admin"`. Nothing else. It does not lift the
 * call cap, the agent-run allowance or any rate limit, and a test pins that.
 *
 * This module holds ONLY the read, and imports only drizzle and the schema.
 * The page guard lives in `admin-page.ts` because it needs Next's request
 * APIs, and this one is reached from the MCP dispatch, which the Express
 * server imports and runs outside any Next request. The plan named one
 * module; keeping them together would have pulled `next/headers` and the db
 * singleton into the Express process's import graph for the first time.
 */

/**
 * True only for the exact string `"admin"`.
 *
 * Any other value — `"Admin"`, `"superuser"`, a value a future build writes
 * and this one has never heard of, a row that does not exist — reads as an
 * ordinary user. Least privilege, and the same rule `planLimits` follows for
 * an unknown plan: the unrecognised case must be the harmless one.
 *
 * Deliberately uncached. This is one indexed primary-key read on surfaces
 * that see a handful of requests a day, and a cached role is a revocation
 * that does not take effect.
 */
export async function isAdmin(db: Database, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return row?.role === "admin";
}
