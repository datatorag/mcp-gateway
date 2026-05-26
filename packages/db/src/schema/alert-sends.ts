import { integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

// Dedupes 80/100/150% alerts within one billing period.
export const alertSends = pgTable(
  "alert_sends",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    thresholdPct: integer("threshold_pct").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    channel: text("channel").notNull().default("email"),
  },
  (table) => [primaryKey({ columns: [table.userId, table.periodStart, table.thresholdPct] })]
);
