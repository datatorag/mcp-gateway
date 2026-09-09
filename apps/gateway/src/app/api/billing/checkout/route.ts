import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getEnv } from "@datatorag-mcp/config";
import { users } from "@datatorag-mcp/db";
import { db } from "@/lib/db";
import { withRoute } from "@/lib/with-route";
import { ensureStripeCustomer, getStripe } from "@/lib/stripe";
import { isPromoCode, promoActive } from "@/lib/promo";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  interval: z.enum(["monthly", "yearly"]),
  /** SCRUM-231: the campaign code as the banner carried it. Only the exact
   * campaign code, while the campaign is active and the promotion code id
   * is configured, changes anything; the id itself never comes from here. */
  promo: z.string().max(32).optional(),
});

/**
 * Start a Stripe Checkout session for Pro. Returns the hosted checkout URL;
 * the plan flips to `pro` only when the subscription webhook lands — nothing
 * here grants anything.
 *
 * SERVER-CREATED SESSION, DELIBERATELY — not a Payment Link, even though the
 * card page is 100% Stripe-hosted either way (no Stripe.js ships from this
 * repo). The difference is who establishes the user↔customer mapping: a
 * Payment Link carries `client_reference_id` in a user-visible URL, where it
 * can be edited to attach a subscription to someone else's account. Here the
 * mapping comes from the authenticated session and cannot be forged. Same
 * principle as the login `next` validation: a user-controllable value that
 * decides an outcome must be established server-side.
 */
export const POST = withRoute(async (userId, req: NextRequest) => {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "interval must be 'monthly' or 'yearly'" },
      { status: 400 }
    );
  }
  const env = getEnv();
  const priceId =
    parsed.data.interval === "monthly"
      ? env.STRIPE_PRO_MONTHLY_PRICE_ID
      : env.STRIPE_PRO_YEARLY_PRICE_ID;
  if (!priceId || !env.STRIPE_API_KEY) {
    return NextResponse.json({ error: "Billing is not configured" }, { status: 503 });
  }

  const [user] = await db
    .select({ email: users.email, stripeCustomerId: users.stripeCustomerId, plan: users.plan })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.plan === "pro") {
    return NextResponse.json({ error: "Already on Pro" }, { status: 409 });
  }

  const customerId = await ensureStripeCustomer({
    userId,
    email: user.email,
    existingId: user.stripeCustomerId,
  });
  if (!user.stripeCustomerId) {
    // Persist BEFORE redirecting to Stripe: the webhook resolves the user by
    // customer id, and the subscription events can arrive before (or without)
    // checkout.session.completed. Writing the linkage first makes webhook
    // ordering irrelevant.
    await db
      .update(users)
      .set({ stripeCustomerId: customerId, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  // SCRUM-231: the campaign code is APPLIED, not only shown. Stripe refuses
  // `discounts` together with `allow_promotion_codes`, so exactly one of the
  // two is sent: the discount when the body carries the campaign's code, the
  // campaign is active by the clock and the promotion code id is configured;
  // the open promo-code field otherwise, which is how a comped or
  // coupon-holding customer has somewhere to type a code. The id is read
  // from configuration only; nothing in the request can name one.
  const applyPromo =
    isPromoCode(parsed.data.promo) && promoActive(new Date()) && Boolean(env.STRIPE_PROMOTION_CODE_ID);
  const promoParams = applyPromo
    ? { discounts: [{ promotion_code: env.STRIPE_PROMOTION_CODE_ID }] }
    : { allow_promotion_codes: true };

  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: userId,
    line_items: [{ price: priceId, quantity: 1 }],
    ...promoParams,
    // Belt-and-braces user resolution for the webhook, should the customer-id
    // write above ever be lost to a partial failure.
    subscription_data: { metadata: { user_id: userId } },
    success_url: `${env.GATEWAY_BASE_URL}/dashboard?checkout=success`,
    cancel_url: `${env.GATEWAY_BASE_URL}/dashboard?checkout=cancelled`,
  });

  return NextResponse.json({ url: session.url });
}, { logContext: "[billing/checkout]" });
