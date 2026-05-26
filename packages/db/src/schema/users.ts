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
  plan: text("plan").$type<Plan>().notNull().default("pro_trial"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  currentPeriodCalls: integer("current_period_calls").notNull().default(0),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
