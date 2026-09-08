import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";
import { skillSchedules } from "./skill-schedules";

export const RUN_STATUSES = ["running", "succeeded", "refused", "reconnect", "failed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** What reached the user. `skill_email`: the skill mailed them itself.
 * `notification_email`: our one email per run. `thread_only`: neither, which
 * only happens when email is not configured or the send failed. */
export const DELIVERIES = ["skill_email", "notification_email", "thread_only"] as const;
export type Delivery = (typeof DELIVERIES)[number];

/**
 * One scheduled run (SCRUM-225). The thread is the full record of what the
 * run did; this row is the index into it, and it is also the row that says
 * why a run did NOT happen: a refused claim is a row, not a silence.
 */
export const skillRuns = pgTable(
  "skill_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => skillSchedules.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    skillSlug: text("skill_slug").notNull(),
    trigger: text("trigger").notNull().default("scheduled"),
    status: text("status").$type<RunStatus>().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** The playground thread the run wrote to, once it started a turn. */
    threadId: text("thread_id"),
    /** The agent run id the usage events carry. */
    runId: text("run_id"),
    /** Tool name to call count, as the turn reported them. */
    toolCalls: jsonb("tool_calls").$type<Record<string, number>>().notNull().default({}),
    toolCallCount: integer("tool_call_count").notNull().default(0),
    delivered: text("delivered").$type<Delivery>(),
    /** Capped the same way stored tool errors are. */
    error: text("error"),
  },
  (table) => [index("skill_runs_schedule_started_idx").on(table.scheduleId, table.startedAt)]
);
