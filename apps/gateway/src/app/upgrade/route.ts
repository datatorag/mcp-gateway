import { NextResponse } from "next/server";

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
 * A route handler rather than a page, deliberately. Starting a checkout session
 * is a server action with a redirect as its result, so the eventual
 * implementation replaces the body of this function and keeps its signature.
 */
export function GET(request: Request) {
  return NextResponse.redirect(new URL("/pricing", request.url));
}
