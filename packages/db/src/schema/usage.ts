import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  date,
  primaryKey,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    connector: text("connector"),
    accountEmail: text("account_email"),
    status: text("status").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    responseSizeBytes: integer("response_size_bytes"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    idempotencyKey: text("idempotency_key"),
    costUnits: integer("cost_units"),
    argumentsSizeBytes: integer("arguments_size_bytes"),
    client: text("client"),
  },
  (table) => [
    index("idx_usage_events_user_created").on(
      table.userId,
      table.createdAt.desc()
    ),
    index("idx_usage_events_user_tool_created").on(
      table.userId,
      table.toolName,
      table.createdAt.desc()
    ),
  ]
);

export const usageEventsDaily = pgTable(
  "usage_events_daily",
  {
    day: date("day").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    connector: text("connector"),
    calls: integer("calls").notNull(),
    errors: integer("errors").notNull(),
    p50Ms: integer("p50_ms").notNull(),
    p95Ms: integer("p95_ms").notNull(),
    totalBytes: integer("total_bytes").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.day, table.userId, table.toolName] }),
    index("idx_usage_daily_user_day").on(table.userId, table.day),
  ]
);
