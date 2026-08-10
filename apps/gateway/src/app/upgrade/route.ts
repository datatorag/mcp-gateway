/**
 * The one upgrade entry point. Every "get more runs" control in the product
 * points here and keeps pointing here.
 *
 * THIS IS A SEAM, AND THAT IS ITS WHOLE JOB. Self-serve checkout is coming.
 * When it lands, this handler starts a Stripe Checkout session and redirects to
 * its URL, and nothing else in the product changes: no component learns a new
 * href, no copy is rewritten, no panel is redesigned. Today it forwards to the
 * page that describes the plans, because that is the furthest a user can
 * actually get.
 *
 * The alternative was to point the CTA at `/pricing` directly and re-point it
 * later. That spreads the swap across every call site and guarantees one gets
 * missed, which is the same shape of bug as a tool shipping without being
 * registered: the code changes and one of the places that references it does
 * not.
 *
 * A RELATIVE Location, not `new URL("/pricing", request.url)`. That was the
 * first version and it was broken in production the moment it shipped: behind
 * the CDN the origin is terminated upstream and `request.url` is the INTERNAL
 * address, so the redirect resolved to localhost and the control was a dead
 * link. A relative target is resolved by the browser against the address the
 * user actually typed, so it cannot leak an internal host and cannot depend on
 * how many proxies are in front of this process.
 *
 * When this becomes a real checkout redirect it will need an ABSOLUTE external
 * URL, and that one must come from configured origin, never from `request.url`
 * for the same reason.
 */
export function GET() {
  return new Response(null, {
    status: 307,
    headers: { Location: "/pricing" },
  });
}
