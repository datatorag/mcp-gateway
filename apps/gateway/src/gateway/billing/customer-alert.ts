import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import type { Database } from "@datatorag-mcp/db";
import { users } from "@datatorag-mcp/db";
import { getEnv } from "@datatorag-mcp/config";
import { sendSlack } from "../../lib/slack";
import { isInternalEmail } from "../../lib/brevo";
import { acquisitionSourceLine } from "../signup-alert";

/**
 * Real-time #leads post when someone ACTUALLY becomes a customer (SCRUM-212).
 *
 * THE EVENT IS `customer.subscription.created` WITH A PAYING STATUS, AND THE
 * CHOICE IS THE WHOLE POINT. The tempting one is `customer.created`, because
 * it has the word customer in it. Our own checkout route emits it the moment
 * checkout BEGINS, before anyone has paid, so an alert on it would post for
 * every abandoned checkout; that is precisely how the daily digest came to
 * announce a customer where there was only a started checkout (SCRUM-211).
 * `payment_intent.
 * succeeded` was the other candidate and was rejected too: it fires on every
 * renewal as well as the first payment, and it does not carry our user or
 * the plan, so it would page monthly for the customers we already have and
 * say the least. A created subscription with an active status fires once, at
 * the moment the first payment has cleared through Checkout, and carries the
 * price. That is "new customer".
 *
 * Idempotence comes from the webhook handler's existing event claim: a
 * replayed delivery returns before this is called. No second scheme.
 */
export type NewCustomer = {
  customerId: string | null;
  metadataUserId: string | undefined;
  subscriptionId: string;
  priceId: string | null;
  amountCents: number | null;
  currency: string | null;
  interval: string | null;
};

const PAYING_STATUSES: ReadonlySet<Stripe.Subscription.Status> = new Set([
  "active",
  "trialing",
]);

/** The one event that means a new customer, or null for everything else. */
export function newCustomerFromEvent(event: Stripe.Event): NewCustomer | null {
  if (event.type !== "customer.subscription.created") return null;
  const sub = event.data.object as Stripe.Subscription;
  if (!PAYING_STATUSES.has(sub.status)) return null;
  const item = sub.items?.data?.[0];
  const price = item?.price;
  return {
    customerId:
      typeof sub.customer === "string" ? sub.customer : (sub.customer?.id ?? null),
    metadataUserId: sub.metadata?.user_id,
    subscriptionId: sub.id,
    priceId: price?.id ?? null,
    amountCents: typeof price?.unit_amount === "number" ? price.unit_amount : null,
    currency: price?.currency ?? null,
    interval: price?.recurring?.interval ?? null,
  };
}

function planLabel(priceId: string | null): string {
  const env = getEnv();
  if (priceId && priceId === env.STRIPE_PRO_MONTHLY_PRICE_ID) return "Pro monthly";
  if (priceId && priceId === env.STRIPE_PRO_YEARLY_PRICE_ID) return "Pro yearly";
  // An unrecognised price is worth naming: it means the catalogue moved
  // without this alert being told.
  return priceId ? `unrecognised price ${priceId}` : "unknown plan";
}

function amountLabel(nc: NewCustomer): string {
  if (nc.amountCents === null || !nc.currency) return "amount unknown";
  const major = (nc.amountCents / 100).toFixed(2);
  const symbol = nc.currency.toLowerCase() === "usd" ? "$" : `${nc.currency.toUpperCase()} `;
  return `${symbol}${major}${nc.interval ? `/${nc.interval}` : ""}`;
}

/**
 * Fire-and-forget safe: never throws, skips internal accounts, and posts
 * with the raw customer id when no user matches, because a payment we cannot
 * attribute is the loudest possible sign that the customer link is broken and
 * silence would hide a real payment.
 */
export async function notifyNewCustomer(db: Database, nc: NewCustomer): Promise<void> {
  try {
    const columns = {
      id: users.id,
      email: users.email,
      name: users.name,
      acquisitionChannel: users.acquisitionChannel,
      acquisitionUtmSource: users.acquisitionUtmSource,
      acquisitionUtmMedium: users.acquisitionUtmMedium,
      acquisitionUtmCampaign: users.acquisitionUtmCampaign,
      acquisitionGclid: users.acquisitionGclid,
      acquisitionReferringDomain: users.acquisitionReferringDomain,
    };
    let [user] = nc.customerId
      ? await db.select(columns).from(users).where(eq(users.stripeCustomerId, nc.customerId)).limit(1)
      : [];
    if (!user && nc.metadataUserId) {
      [user] = await db.select(columns).from(users).where(eq(users.id, nc.metadataUserId)).limit(1);
    }

    const plan = planLabel(nc.priceId);
    const amount = amountLabel(nc);

    if (!user) {
      await sendSlack("leads", {
        text:
          `🟢 New customer: ${plan}, ${amount}` +
          `\nStripe customer ${nc.customerId ?? "(none)"}, subscription ${nc.subscriptionId}` +
          `\n⚠️ no matching user in our database; the customer link may be broken`,
      });
      return;
    }
    if (isInternalEmail(user.email)) {
      console.log(`[customer-alert] skipping internal ${user.email}`);
      return;
    }
    await sendSlack("leads", {
      text:
        `🟢 New customer: ${user.name ?? "(no name)"} <${user.email}>` +
        `\nPlan: ${plan}, ${amount}` +
        `\n${acquisitionSourceLine(user)}` +
        `\nSubscription: ${nc.subscriptionId}`,
    });
  } catch (err) {
    console.warn(`[customer-alert] failed for subscription ${nc.subscriptionId}`, err);
  }
}
