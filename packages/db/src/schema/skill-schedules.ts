import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const SCHEDULE_CADENCES = ["daily", "weekdays", "weekly"] as const;
export type ScheduleCadence = (typeof SCHEDULE_CADENCES)[number];

/** Why a schedule is paused. `user` is the one-click pause; the other three
 * are the runner's, one per outcome that stops a schedule on its own. */
export const PAUSE_REASONS = ["user", "allowance", "reconnect", "failures"] as const;
export type PauseReason = (typeof PAUSE_REASONS)[number];

/**
 * A scheduled skill run (SCRUM-225): one row per user and skill.
 *
 * `next_run_at` is computed in code from the cadence, hour, minute and the
 * user's own time zone, and it is the CLAIM KEY: the runner advances a due
 * row with `WHERE id = $1 AND next_run_at = $observed`, so two ticks or two
 * processes can never run the same schedule twice. The reason and the
 * failure count are what the dashboard shows and what Resume clears.
 */
export const skillSchedules = pgTable(
  "skill_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    skillSlug: text("skill_slug").notNull(),
    cadence: text("cadence").$type<ScheduleCadence>().notNull(),
    /** 0-23, in `timezone`. */
    hour: integer("hour").notNull(),
    /** 0-59, in `timezone`. */
    minute: integer("minute").notNull().default(0),
    /** 0 (Sunday) to 6, for `weekly` only. */
    weekday: integer("weekday"),
    /** IANA zone name, captured from the browser at save. */
    timezone: text("timezone").notNull(),
    paused: boolean("paused").notNull().default(false),
    pausedReason: text("paused_reason").$type<PauseReason>(),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("skill_schedules_user_skill_idx").on(table.userId, table.skillSlug),
    index("skill_schedules_due_idx").on(table.paused, table.nextRunAt),
  ]
);
