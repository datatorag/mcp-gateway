import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { isStripeHostedUrl } from "@/lib/stripe-hosted-url";

/**
 * The payment method and recent invoices for the Billing page (SCRUM-352),
 * read from Stripe on the server with the key checkout and the portal
 * already use. READS ONLY: a customer retrieve, a payment-method list as the
 * fallback, and an invoice list. Nothing here creates or changes anything in
 * Stripe.
 *
 * NEVER FAILS THE PAGE. Each half has its own timeout and its own "unavailable"
 * result, and the page shows a line pointing at the portal instead. A slow or
 * down Stripe costs the user a card on the page, not the page.
 */

export interface PaymentMethodSummary {
  /** "card", or another Stripe payment method type. */
  type: string;
  brand?: string;
  last4?: string;
  expMonth?: number;
  expYear?: number;
}

export interface InvoiceSummary {
  id: string;
  created: Date;
  /** Minor units, in `currency`. */
  amount: number;
  currency: string;
  status: string | null;
  /** Only Stripe-hosted URLs are kept; anything else becomes null. */
  pdfUrl: string | null;
}

export type Loaded<T> = { ok: true; value: T } | { ok: false };

export interface BillingDetails {
  paymentMethod: Loaded<PaymentMethodSummary | null>;
  invoices: Loaded<InvoiceSummary[]>;
}

export const STRIPE_TIMEOUT_MS = 3000;
export const INVOICE_LIMIT = 5;

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<Loaded<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Loaded<T>>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false }), ms);
  });
  try {
    return await Promise.race([work.then((value) => ({ ok: true as const, value })), timeout]);
  } catch (err) {
    console.error("[billing/details] Stripe read failed:", err instanceof Error ? err.message : err);
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

function summarise(pm: Stripe.PaymentMethod): PaymentMethodSummary {
  if (pm.type === "card" && pm.card) {
    return { type: "card", brand: pm.card.brand, last4: pm.card.last4, expMonth: pm.card.exp_month, expYear: pm.card.exp_year };
  }
  return { type: pm.type };
}

async function paymentMethod(stripe: Stripe, customerId: string): Promise<PaymentMethodSummary | null> {
  const customer = await stripe.customers.retrieve(customerId, {
    expand: ["invoice_settings.default_payment_method"],
  });
  if ("deleted" in customer && customer.deleted) return null;
  const preferred = (customer as Stripe.Customer).invoice_settings?.default_payment_method;
  if (preferred && typeof preferred === "object") return summarise(preferred);
  // A subscription paid through checkout can leave the customer default unset
  // and hold the method on the subscription; the customer's attached card is
  // the same card.
  const listed = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 });
  return listed.data[0] ? summarise(listed.data[0]) : null;
}

async function invoices(stripe: Stripe, customerId: string): Promise<InvoiceSummary[]> {
  const list = await stripe.invoices.list({ customer: customerId, limit: INVOICE_LIMIT });
  return list.data
    .filter((inv): inv is Stripe.Invoice & { id: string } => typeof inv.id === "string")
    .map((inv) => ({
      id: inv.id,
      created: new Date(inv.created * 1000),
      amount: inv.status === "paid" ? inv.amount_paid : inv.total,
      currency: inv.currency,
      status: inv.status ?? null,
      pdfUrl: inv.invoice_pdf && isStripeHostedUrl(inv.invoice_pdf) ? inv.invoice_pdf : null,
    }));
}

export async function loadBillingDetails(
  customerId: string,
  client?: Stripe,
  timeoutMs = STRIPE_TIMEOUT_MS
): Promise<BillingDetails> {
  let stripe: Stripe;
  try {
    stripe = client ?? getStripe();
  } catch (err) {
    // No key configured (a local gateway): the same degrade as Stripe being down.
    console.error("[billing/details] Stripe unavailable:", err instanceof Error ? err.message : err);
    return { paymentMethod: { ok: false }, invoices: { ok: false } };
  }
  const [pm, inv] = await Promise.all([
    withTimeout(paymentMethod(stripe, customerId), timeoutMs),
    withTimeout(invoices(stripe, customerId), timeoutMs),
  ]);
  return { paymentMethod: pm, invoices: inv };
}
