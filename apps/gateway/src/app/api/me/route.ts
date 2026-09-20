import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { withRoute } from "@/lib/with-route";
import { users } from "@datatorag-mcp/db";

// GET /api/me — return current user info
export const GET = withRoute(async (userId) => {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      // SCRUM-231: the dashboard promo banner hides for a paying customer.
      // Same denormalised column the checkout route refuses "Already on Pro"
      // from, so the banner and the checkout agree on who is paying.
      plan: users.plan,
      // SCRUM-302. The caller's OWN role, for the dashboard rail: the admin
      // entry renders only when this says "admin". Presentation only — every
      // admin surface re-reads the column server-side, so a client that lies
      // to itself about this gains nothing.
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({ user });
});
