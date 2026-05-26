import Stripe from "stripe";
import { getEnv } from "@datatorag-mcp/config";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const { STRIPE_API_KEY } = getEnv();
  if (!STRIPE_API_KEY) {
    throw new Error("STRIPE_API_KEY not configured");
  }
  _stripe = new Stripe(STRIPE_API_KEY);
  return _stripe;
}

/** Lazily create or return the Stripe Customer ID for a user. */
export async function ensureStripeCustomer(args: {
  userId: string;
  email: string;
  existingId: string | null;
}): Promise<string> {
  if (args.existingId) return args.existingId;
  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: args.email,
    metadata: { user_id: args.userId },
  });
  return customer.id;
}
