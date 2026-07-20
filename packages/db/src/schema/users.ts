import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const PLAN_VALUES = ["free", "pro_trial", "pro", "payg"] as const;
export type Plan = (typeof PLAN_VALUES)[number];

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  emailVerified: boolean("email_verified").notNull().default(false),
  avatarUrl: text("avatar_url"),
  stripeCustomerId: text("stripe_customer_id").unique(),
  // Denormalized from subscriptions.status for hot-path reads — every tool call
  // checks plan in the tier gate, and joining to subscriptions per call is too
  // expensive. Kept in sync by the Stripe webhook handlers (see billing/webhook-handlers.ts).
  plan: text("plan").$type<Plan>().notNull().default("pro_trial"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  currentPeriodCalls: integer("current_period_calls").notNull().default(0),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // Activation milestone: set once on the user's first successful tool call
  // (see trackToolCall) so the funnel has a durable first_tool_call marker.
  firstToolCallAt: timestamp("first_tool_call_at", { withTimezone: true }),
  // Set when the no-activation follow-up email is claimed for sending
  // (see lifecycle.ts) — the IS NULL guard makes double-sends impossible.
  noActivationFollowupSentAt: timestamp("no_activation_followup_sent_at", {
    withTimezone: true,
  }),
  // Lifetime count of playground chat messages sent (dashboard playground).
  // Capped by PLAYGROUND_MESSAGE_CAP; deliberately NOT part of billing/credits.
  playgroundMessagesUsed: integer("playground_messages_used").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
