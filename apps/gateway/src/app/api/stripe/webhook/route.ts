import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getEnv } from "@datatorag-mcp/config";
import { db } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { handleStripeEvent } from "@/gateway/billing/webhook-handlers";

// PUBLIC and UNAUTHENTICATED by design — Stripe calls it, no session exists.
// Authentication is the webhook signature: constructEvent verifies the
// payload HMAC against STRIPE_WEBHOOK_SECRET, so an unsigned or tampered
// request never reaches a handler. That check REQUIRES the raw request body —
// any middleware that parses the body first breaks it (Express json() is
// mounted only on /oauth and /mcp, so this path receives the stream intact).
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { STRIPE_WEBHOOK_SECRET } = getEnv();
  if (!STRIPE_WEBHOOK_SECRET) {
    // Not configured (dev without `stripe listen`): refuse rather than
    // accepting unverifiable events. 503 so a misconfigured prod is loud.
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }
  const payload = await req.text();

  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(
      payload,
      signature,
      STRIPE_WEBHOOK_SECRET
    );
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    const outcome = await handleStripeEvent(db, event);
    return NextResponse.json({ received: true, ...outcome });
  } catch (err) {
    // 500 makes Stripe redeliver; the handler rolled back its event claim,
    // so the retry is processed fresh rather than skipped as a duplicate.
    console.error(`[stripe-webhook] ${event.type} ${event.id} failed`, err);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}
