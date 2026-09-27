import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { users } from "@datatorag-mcp/db";
import { db } from "@/lib/db";
import { getSessionUserId } from "@/lib/session";
import { billingUsage } from "@/gateway/usage/period";
import { loadBillingDetails } from "@/lib/billing-details";
import { BillingView } from "./billing-view";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/auth/login");

  // Read server-side so the page is right on FIRST PAINT. Plan decides what
  // is described, stripe_customer_id decides whether there is a billing
  // relationship to show or manage (SCRUM-81: different questions, and only
  // the second predicts whether the portal works).
  const [[user], usage] = await Promise.all([
    db
      .select({ plan: users.plan, stripeCustomerId: users.stripeCustomerId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
    billingUsage(db, userId),
  ]);

  const customerId = user?.stripeCustomerId ?? null;
  // Stripe is asked only when there is a customer to ask about, and a slow or
  // failing Stripe degrades each section to a portal link (billing-details).
  const details = customerId ? await loadBillingDetails(customerId) : undefined;

  return (
    <BillingView
      plan={user?.plan ?? "free"}
      hasBillingAccount={Boolean(customerId)}
      usage={usage}
      details={details}
    />
  );
}
