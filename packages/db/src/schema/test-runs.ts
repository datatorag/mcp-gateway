import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

/** Where the run executed (SCRUM-303). Never inferred from a hostname: it
 * comes from one config value that defaults to `local` and is set to `prod`
 * only in the production compose file. The comparison the deploy gate rests
 * on is a local run of a candidate against the current prod baseline, and
 * those live in different databases, so a run has to say which it is. */
export const TEST_ENVIRONMENTS = ["local", "prod"] as const;
export type TestEnvironment = (typeof TEST_ENVIRONMENTS)[number];

export const TEST_RUN_TRIGGERS = ["ui", "mcp"] as const;
export type TestRunTrigger = (typeof TEST_RUN_TRIGGERS)[number];

/** `interrupted` is not a failure mode a run reports about itself: a deploy
 * restarts the process and the run dies with it, so rows left `running` are
 * marked at the next boot. Without it a killed run stays `running` forever
 * and blocks the one-at-a-time claim. */
export const TEST_RUN_STATUSES = ["running", "finished", "aborted", "interrupted"] as const;
export type TestRunStatus = (typeof TEST_RUN_STATUSES)[number];

export type TestRunScope = { tier?: 1 | 2; caseIds?: string[] };
export type TestRunTotals = { pass: number; fail: number; skip: number; uncovered: number };

/**
 * One execution of the test suite (SCRUM-303).
 *
 * The run records the SHAS it ran against, because the question the suite
 * exists to answer is "what worked before, and does it still" across a
 * four-step plugin rewrite. A result set with no sha beside it cannot answer
 * it.
 */
export const testRuns = pgTable(
  "test_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The admin who pressed the button or made the call. The run lists and
     * calls as this user, with this user's connected accounts; there is no
     * runner user and no minted credential. */
    triggeredBy: uuid("triggered_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    trigger: text("trigger").$type<TestRunTrigger>().notNull(),
    /** What was ASKED for, not what ran: a scope plus the plan's own skips
     * is how a partial run explains itself. */
    scope: jsonb("scope").$type<TestRunScope>().notNull().default({}),
    status: text("status").$type<TestRunStatus>().notNull(),
    environment: text("environment").$type<TestEnvironment>().notNull(),
    /** Set only on a run imported from another environment, to the source
     * run's id. An imported run is read-only and can only ever be the other
     * side of a diff. */
    importedFrom: text("imported_from"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Baked into the image at build time. Null where the build had none,
     * and the diff then says "sha unknown" rather than guessing. */
    gatewaySha: text("gateway_sha"),
    pluginShas: jsonb("plugin_shas").$type<Record<string, string | null>>().notNull().default({}),
    /** Size of `tools/list` for this run's identity. Per identity, so it is
     * a fact about the run rather than about the registry. */
    toolsServed: integer("tools_served").notNull().default(0),
    totals: jsonb("totals")
      .$type<TestRunTotals>()
      .notNull()
      .default({ pass: 0, fail: 0, skip: 0, uncovered: 0 }),
  },
  (table) => [
    index("test_runs_started_at_idx").on(table.startedAt.desc()),
    /**
     * ONE RUNNING ROW, enforced by Postgres (SCRUM-303).
     *
     * The conditional INSERT in `store.ts` reads as a claim and is not one:
     * `WHERE NOT EXISTS` under READ COMMITTED takes no lock on a row that
     * does not exist, so two concurrent callers can both see "none running"
     * and both insert. This index is what actually makes the second one
     * fail. Two runs would race on the same scratch tab and the same labels,
     * so a second run has to be refused rather than merely discouraged.
     */
    uniqueIndex("test_runs_one_running_uq")
      .on(table.status)
      .where(sql`status = 'running'`),
  ]
);
