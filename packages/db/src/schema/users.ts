import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Binary by decision: the free tier IS the trial. A time-boxed trial plan
// existed here once and was retired — it promised an expiry nothing enforced.
export const PLAN_VALUES = ["free", "pro", "payg"] as const;
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
  plan: text("plan").$type<Plan>().notNull().default("free"),
  // Gateway tool calls in the current period, and agent runs in the same
  // period. Both are COUNTERS, not a ledger: incremented in place, approximate
  // is fine, a little lag is harmless. Billing needs dedup and an audit trail
  // and will get its own rows; these exist to enforce an allowance.
  //
  // They roll together, lazily, off `currentPeriodStart` — see
  // `gateway/usage/period.ts`. Nothing schedules the reset, so the roll happens
  // on the next increment after the period lapses. Two counters sharing one
  // start is the reason the roll must reset both at once: resetting either on
  // its own would leave the pair describing different windows.
  currentPeriodCalls: integer("current_period_calls").notNull().default(0),
  currentPeriodAgentRuns: integer("current_period_agent_runs").notNull().default(0),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // Activation milestone: set once on the user's first successful tool call
  // (see trackToolCall) so the funnel has a durable first_tool_call marker.
  firstToolCallAt: timestamp("first_tool_call_at", { withTimezone: true }),
  /** First AGENT RUN, kept separate from `first_tool_call_at` on purpose.
   *
   * The two markers answer different questions. `first_tool_call_at` means "a
   * real (non-builtin) plugin tool call succeeded for this user" — since
   * SCRUM-78 on EITHER surface, because an agent that read the user's own
   * mailbox is activation by any honest reading, and the no-activation email
   * must not nag a user it happened to. This one means only "an agent turn
   * ran", which a model can do with no connected account and no tool call at
   * all — the exact fails-while-appearing-to-succeed state SCRUM-78 exists to
   * close — so it must never be read as activation.
   *
   * A column rather than deriving it from `current_period_agent_runs > 0`,
   * because that counter resets: a user who ran the agent in March and came
   * back in June would read as never activated. */
  firstAgentRunAt: timestamp("first_agent_run_at", { withTimezone: true }),
  // Set when the no-activation follow-up email is claimed for sending
  // (see lifecycle.ts) — the IS NULL guard makes double-sends impossible.
  noActivationFollowupSentAt: timestamp("no_activation_followup_sent_at", {
    withTimezone: true,
  }),
  // First-touch acquisition snapshot, captured from the browser at signup.
  // Server-side events cannot be attributed without a session id, and a
  // session id only joins for as long as the analytics session row is
  // retained — these columns are the durable copy, so "which channel and
  // campaign produced this user" stays answerable past any retention window.
  // Every column is nullable: the visitor may have the SDK blocked, and the
  // rows that predate this were never captured.
  acquisitionSessionId: text("acquisition_session_id"),
  acquisitionDistinctId: text("acquisition_distinct_id"),
  acquisitionChannel: text("acquisition_channel"),
  acquisitionUtmSource: text("acquisition_utm_source"),
  acquisitionUtmMedium: text("acquisition_utm_medium"),
  acquisitionUtmCampaign: text("acquisition_utm_campaign"),
  acquisitionGclid: text("acquisition_gclid"),
  acquisitionReferringDomain: text("acquisition_referring_domain"),
  acquisitionEntryUrl: text("acquisition_entry_url"),
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
