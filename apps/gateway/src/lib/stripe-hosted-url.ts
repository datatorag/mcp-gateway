/**
 * True only for an https URL on stripe.com or a subdomain (checkout.stripe.com,
 * billing.stripe.com). Defense in depth for the two client flows that follow a
 * server-returned Stripe URL: the trust boundary is our own authenticated API,
 * but pinning the destination here means a future server-side bug cannot be
 * amplified into a client-side redirect to an arbitrary host. endsWith on
 * ".stripe.com" (not a host list) so a Stripe-side host change or a new
 * hosted surface does not turn this guard into the outage.
 */
export function isStripeHostedUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" &&
    (parsed.hostname === "stripe.com" || parsed.hostname.endsWith(".stripe.com"))
  );
}
