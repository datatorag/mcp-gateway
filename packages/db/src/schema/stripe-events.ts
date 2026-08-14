import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Webhook idempotency ledger: one row per Stripe event ever processed.
 *
 * Stripe redelivers — on timeouts, on retries, and on manual resend from the
 * dashboard — and a webhook handler that applies the same event twice is a
 * double-charge waiting to happen. The handler claims the event id with an
 * INSERT ... ON CONFLICT DO NOTHING before doing any work; a claim that
 * inserts zero rows means another delivery already owns this event, and the
 * handler acknowledges without touching anything else.
 *
 * The primary key IS the guard. Stripe event ids (`evt_...`) are globally
 * unique and stable across redeliveries of the same event.
 */
export const stripeEvents = pgTable("stripe_events", {
  /** Stripe event id (`evt_...`) — the identity Stripe holds constant across
   * redeliveries, which is what makes it the dedup key. */
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});
