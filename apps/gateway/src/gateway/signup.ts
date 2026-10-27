import { eq } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { users } from "@datatorag-mcp/db";
import type { Attribution } from "../lib/attribution";
import { persistAcquisition } from "./attribution";
import { trackSignup, type SignupSource } from "./track";
import { sendWelcomeEmail } from "./lifecycle";
import { notifySignup } from "./signup-alert";

type User = typeof users.$inferSelect;

/** Where a signup started (SCRUM-89). The dashboard has a landing page to
 * attribute; an MCP client (Claude, Claude Code, Cursor) has only the name it
 * registered with, which is the client's own claim. */
export type SignupEntry =
  | { entry: "dashboard"; attribution: Attribution | null; skill: string | null }
  | { entry: "mcp_client"; clientName: string | null };

/**
 * The user for a Google sign-in, created when there is none. `isNewUser` is
 * true for exactly one caller per email: the insert is the claim, so two
 * first sign-ins racing from two clients cannot both run the signup side
 * effects.
 */
export async function findOrCreateGoogleUser(
  db: Database,
  googleUser: { email: string; name?: string; picture?: string }
): Promise<{ user: User; isNewUser: boolean }> {
  const [existing] = await db.select().from(users).where(eq(users.email, googleUser.email)).limit(1);
  if (existing) return { user: existing, isNewUser: false };
  const [created] = await db
    .insert(users)
    .values({
      email: googleUser.email,
      name: googleUser.name ?? null,
      emailVerified: true,
      avatarUrl: googleUser.picture ?? null,
    })
    .onConflictDoNothing({ target: users.email })
    .returning();
  if (created) return { user: created, isNewUser: true };
  const [winner] = await db.select().from(users).where(eq(users.email, googleUser.email)).limit(1);
  return { user: winner, isNewUser: false };
}

/**
 * Everything a new user gets, whichever door they came in by: the durable
 * acquisition copy, the signup event, the welcome email and the #leads post.
 * Called once, by the caller that created the user. Nothing here throws into
 * the sign-in.
 */
export async function onNewUser(db: Database, user: User, signup: SignupEntry): Promise<void> {
  const attribution = signup.entry === "dashboard" ? signup.attribution : null;
  const source: SignupSource =
    signup.entry === "dashboard"
      ? { entry: "dashboard" }
      : { entry: "mcp_client", clientName: signup.clientName };
  // Durable copy first: a session id joins only while the analytics session
  // row survives its retention window, a column on the user does not expire.
  await persistAcquisition(db, user.id, attribution);
  // SCRUM-223: the campaign funnel's slug rides on the signup event.
  trackSignup(
    user.id,
    user.email,
    user.name,
    attribution,
    { skill: signup.entry === "dashboard" ? signup.skill : null },
    source
  );
  void sendWelcomeEmail({
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
    plan: user.plan,
  });
  void notifySignup(
    db,
    { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt },
    source
  );
}
