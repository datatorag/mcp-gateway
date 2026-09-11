import { index, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * What one agent run cost (SCRUM-257): the token buckets, the step count and
 * the priced cost, one row per run, keyed by the run id the usage events and
 * the generation telemetry already carry.
 *
 * The row is the run token accumulator's mirror: the chat route upserts it
 * from the same object the ceiling reads after every step and when the run
 * ends, so the counts here can never disagree with the ceiling. A session's
 * cost is a sum over its thread's runs; there is no second ledger.
 *
 * Visibility, not billing: nothing reads this to charge anyone.
 */
export const agentRunUsage = pgTable(
  "agent_run_usage",
  {
    runId: text("run_id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The playground thread the run wrote to. */
    threadId: text("thread_id").notNull(),
    /** The skill slug for a skill-seeded run, null for an ordinary turn. */
    skill: text("skill"),
    model: text("model").notNull(),
    steps: integer("steps").notNull().default(0),
    /** Uncached input tokens. */
    inputTokens: integer("input_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    /** The thinking part of the output, when the provider reports it. */
    reasoningTokens: integer("reasoning_tokens").notNull().default(0),
    /** The ceiling's weighted total: uncached input, cache writes and output
     * in full, cache reads at the cache-read weight. */
    weightedTokens: integer("weighted_tokens").notNull().default(0),
    /** Priced from the model price table at write time. Null when the model
     * has no price row, so an unpriced run never reads as free. */
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_agent_run_usage_user_started").on(table.userId, table.startedAt.desc()),
    index("idx_agent_run_usage_thread").on(table.threadId),
  ]
);
