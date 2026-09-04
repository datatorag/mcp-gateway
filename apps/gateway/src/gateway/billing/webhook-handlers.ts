import type Stripe from "stripe";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { stripeEvents, subscriptions, users, type Plan } from "@datatorag-mcp/db";
import type { SubscriptionStatus } from "@datatorag-mcp/db";
import { newCustomerFromEvent, notifyNewCustomer } from "./customer-alert";

/**
 * Stripe webhook lifecycle, in one place, IDEMPOTENT BY CONSTRUCTION.
 *
 * Stripe redelivers events — on our timeouts, on its retries, and on manual
 * resend — so every handler here must be safe to run twice. Two layers make
 * that true rather than hoped:
 *
 * 1. THE EVENT CLAIM. Each event id is claimed with INSERT ... ON CONFLICT
 *    DO NOTHING into `stripe_events` inside the same transaction as the
 *    handler's writes. A redelivery fails the claim and applies nothing. A
 *    handler that throws rolls the claim back with it, so Stripe's retry of
 *    a genuinely failed delivery is NOT treated as a duplicate.
 * 2. STATE-SHAPED WRITES. Handlers upsert to the state the event describes
 *    (never increment/append), so even a hypothetical double-apply converges
 *    instead of compounding. Layer 1 is the guarantee; this is the seatbelt.
 *
 * WHAT EACH EVENT DOES TO `users.plan`:
 * - checkout.session.completed          → nothing (customer id backfill only;
 *   the subscription events own the plan, so ordering between the two
 *   deliveries cannot matter)
 * - customer.subscription.created/updated → plan follows subscription status:
 *   active|trialing → pro, anything else → free. A subscription updated to
 *   `cancel_at_period_end: true` stays `active` until the period ends, so the
 *   user keeps Pro until then — cancellation respects the paid-through date.
 * - customer.subscription.deleted       → free (fires at period end for a
 *   cancel_at_period_end cancellation, immediately for a hard cancel)
 * - invoice.payment_failed              → free, immediately. A failed payment
 *   must not silently leave someone on Pro; if a Stripe retry later collects,
 *   customer.subscription.updated (status back to `active`) restores Pro.
 */

/** Events this gateway reacts to. Anything else is claimed (so a later
 * subscribe-to-more in the Stripe dashboard can't double-apply old
 * deliveries) and acknowledged without action. */
export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
] as const;

export function planForSubscriptionStatus(status: Stripe.Subscription.Status): Plan {
  // `trialing` maps to pro for Stripe-side completeness only — we never
  // create trialing subscriptions (the free tier is the trial).
  return status === "active" || status === "trialing" ? "pro" : "free";
}

export type WebhookOutcome =
  | { duplicate: true }
  | { duplicate: false; action: string };

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function resolveUserId(
  tx: Tx,
  customerId: string | null,
  metadataUserId: string | undefined
): Promise<string | null> {
  if (customerId) {
    const [byCustomer] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.stripeCustomerId, customerId))
      .limit(1);
    if (byCustomer) return byCustomer.id;
  }
  // Fallback: the checkout route stamps our user id into subscription
  // metadata, so resolution survives even if the customer-id backfill lost a
  // race with the first subscription event.
  if (metadataUserId) {
    const [byId] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, metadataUserId))
      .limit(1);
    if (byId) return byId.id;
  }
  return null;
}

function subscriptionPeriod(sub: Stripe.Subscription): { start: Date; end: Date } {
  // Since API version 2025-03-31 (SDK v18+), the billing period lives on the
  // subscription ITEM, not the subscription. Our subscriptions carry exactly
  // one price, so the first item is the subscription's period.
  const item = sub.items.data[0];
  return {
    start: new Date(item.current_period_start * 1000),
    end: new Date(item.current_period_end * 1000),
  };
}

async function applySubscriptionState(tx: Tx, sub: Stripe.Subscription): Promise<string> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const userId = await resolveUserId(tx, customerId, sub.metadata?.user_id);
  if (!userId) {
    // A subscription for a customer we don't know. Log-and-acknowledge: a 500
    // would make Stripe retry forever, and retrying cannot make the user
    // exist. The claimed event row keeps the evidence.
    console.warn(
      `[stripe-webhook] subscription ${sub.id} for unknown customer ${customerId} — no user updated`
    );
    return "unknown-customer";
  }
  const period = subscriptionPeriod(sub);
  const status = sub.status as SubscriptionStatus;
  const priceId = sub.items.data[0]?.price?.id ?? "";
  await tx
    .insert(subscriptions)
    .values({
      userId,
      stripeSubscriptionId: sub.id,
      stripePriceId: priceId,
      status,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
    })
    .onConflictDoUpdate({
      target: subscriptions.stripeSubscriptionId,
      set: {
        stripePriceId: priceId,
        status,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
        updatedAt: new Date(),
      },
    });
  const plan = planForSubscriptionStatus(sub.status);
  await tx
    .update(users)
    .set({ plan, updatedAt: new Date() })
    .where(eq(users.id, userId));
  return `subscription ${sub.status} → plan ${plan}`;
}

async function applyEvent(tx: Tx, event: Stripe.Event): Promise<string> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.mode !== "subscription") return "ignored non-subscription checkout";
      const userId = session.client_reference_id;
      const customerId =
        typeof session.customer === "string" ? session.customer : session.customer?.id;
      if (!userId || !customerId) return "checkout without user/customer reference";
      // Backfill only — never clobber an existing linkage. The checkout route
      // already persists the customer id before redirecting; this covers rows
      // created before that write existed.
      await tx
        .update(users)
        .set({ stripeCustomerId: customerId, updatedAt: new Date() })
        .where(and(eq(users.id, userId), isNull(users.stripeCustomerId)));
      return "checkout completed";
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      return applySubscriptionState(tx, event.data.object);
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      const customerId =
        typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
      const subDetails = invoice.parent?.subscription_details;
      const subscriptionId =
        typeof subDetails?.subscription === "string"
          ? subDetails.subscription
          : subDetails?.subscription?.id;
      if (subscriptionId) {
        await tx
          .update(subscriptions)
          .set({ status: "past_due", updatedAt: new Date() })
          .where(eq(subscriptions.stripeSubscriptionId, subscriptionId));
      }
      const userId = await resolveUserId(tx, customerId ?? null, undefined);
      if (!userId) return "payment failed for unknown customer";
      // Downgrade NOW rather than waiting for the subscription to reach
      // `unpaid`/`canceled`: a failed payment must not silently leave someone
      // on Pro. If a retry collects, subscription.updated restores Pro.
      await tx
        .update(users)
        .set({ plan: "free", updatedAt: new Date() })
        .where(eq(users.id, userId));
      return "payment failed → plan free";
    }
    default:
      return `unhandled event type ${event.type}`;
  }
}

/**
 * Claim and apply one Stripe event. Returns `{duplicate: true}` for an event
 * id already processed — the caller acknowledges and nothing is touched.
 * Throws (rolling back the claim) on failure, so the delivery is retried.
 */
export async function handleStripeEvent(
  db: Database,
  event: Stripe.Event
): Promise<WebhookOutcome> {
  const outcome = await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(stripeEvents)
      .values({ id: event.id, type: event.type })
      .onConflictDoNothing()
      .returning({ id: stripeEvents.id });
    if (claimed.length === 0) {
      return { duplicate: true as const };
    }
    const action = await applyEvent(tx, event);
    return { duplicate: false as const, action };
  });
  // The #leads alert for a REAL new customer (SCRUM-212), after the
  // transaction has committed so a rolled-back apply never announces
  // anything, and only on a first delivery: the event claim above is what
  // makes a Stripe redelivery a no-op for the database, and the alert rides
  // on that same claim rather than keeping a second record of its own.
  // Awaited, not fire-and-forget: it never throws, Stripe's delivery timeout
  // is generous, and a deterministic post is what the handler test counts.
  if (!outcome.duplicate) {
    const newCustomer = newCustomerFromEvent(event);
    if (newCustomer) await notifyNewCustomer(db, newCustomer);
  }
  return outcome;
}
