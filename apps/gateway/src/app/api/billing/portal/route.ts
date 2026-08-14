import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getEnv } from "@datatorag-mcp/config";
import { users } from "@datatorag-mcp/db";
import { db } from "@/lib/db";
import { withRoute } from "@/lib/with-route";
import { getStripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

/**
 * Stripe Billing Portal session — where a subscriber manages payment methods
 * and cancels. Cancellation defaults to cancel-at-period-end, and the
 * subsequent customer.subscription.updated/deleted webhooks are what change
 * `users.plan`; nothing here mutates state.
 */
export const POST = withRoute(async (userId) => {
  const env = getEnv();
  if (!env.STRIPE_API_KEY) {
    return NextResponse.json({ error: "Billing is not configured" }, { status: 503 });
  }
  const [user] = await db
    .select({ stripeCustomerId: users.stripeCustomerId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user?.stripeCustomerId) {
    return NextResponse.json({ error: "No billing account" }, { status: 400 });
  }
  const session = await getStripe().billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${env.GATEWAY_BASE_URL}/dashboard`,
  });
  return NextResponse.json({ url: session.url });
}, { logContext: "[billing/portal]" });
