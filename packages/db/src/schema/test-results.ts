import { integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { testRuns } from "./test-runs";

/** `case` is a ported smoke row or a runner-native one; `contract` is a
 * per-tool schema check; `uncovered` is a served tool no case exercises. */
export const TEST_RESULT_KINDS = ["case", "contract", "uncovered"] as const;
export type TestResultKind = (typeof TEST_RESULT_KINDS)[number];

export const TEST_RESULT_STATUSES = ["pass", "fail", "skip", "uncovered"] as const;
export type TestResultStatus = (typeof TEST_RESULT_STATUSES)[number];

/**
 * Its own column rather than a fifth status, because "the assertion passed
 * and the cleanup leaked" and "the assertion failed and the cleanup was
 * clean" are both states a reader needs and neither fits in one field.
 * `leaked` makes a run not green even when every assertion passed.
 */
export const TEST_CLEANUPS = ["clean", "none_needed", "leaked"] as const;
export type TestCleanup = (typeof TEST_CLEANUPS)[number];

/**
 * One case, contract check or uncovered tool within a run (SCRUM-303).
 *
 * `evidence` is what a person needs to believe the result: the assertion
 * that failed, expected against actual, the ids of created artifacts. It is
 * capped and redacted before it is written, and it must never become a
 * second copy of a mailbox.
 */
export const testResults = pgTable(
  "test_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => testRuns.id, { onDelete: "cascade" }),
    /** `D15`, or `contract:<tool>`, or `uncovered:<tool>`. */
    caseId: text("case_id").notNull(),
    kind: text("kind").$type<TestResultKind>().notNull(),
    status: text("status").$type<TestResultStatus>().notNull(),
    durationMs: integer("duration_ms").notNull().default(0),
    evidence: text("evidence").notNull().default(""),
    cleanup: text("cleanup").$type<TestCleanup>().notNull().default("none_needed"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("test_results_run_case_uq").on(table.runId, table.caseId)]
);
