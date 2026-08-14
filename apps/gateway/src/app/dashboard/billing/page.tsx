import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { users } from "@datatorag-mcp/db";
import { db } from "@/lib/db";
import { getSessionUserId } from "@/lib/session";
import {
  FREE_MONTHLY_CAP,
  PRO_MONTHLY_INCLUDED,
} from "@/gateway/billing/plans";
import { BillingClient } from "./billing-client";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/auth/login");

  // Both facts are read server-side so the page is right on FIRST PAINT:
  // plan decides what is described, stripe_customer_id decides whether there
  // is a billing relationship to manage (SCRUM-81 — those are different
  // questions, and only the second predicts whether the portal works).
  const [user] = await db
    .select({ plan: users.plan, stripeCustomerId: users.stripeCustomerId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return (
    <BillingClient
      plan={user?.plan ?? "free"}
      hasBillingAccount={Boolean(user?.stripeCustomerId)}
      freeCallsLabel={FREE_MONTHLY_CAP.toLocaleString("en-US")}
      proCallsLabel={PRO_MONTHLY_INCLUDED.toLocaleString("en-US")}
    />
  );
}
