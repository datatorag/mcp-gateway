import { eq } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { users } from "@datatorag-mcp/db";
import { getEnv } from "@datatorag-mcp/config";
import { getSkillBySlug } from "@/lib/skills";
import { hasBrevoKey, sendBrevoEmail } from "@/lib/brevo";
import { planLimits } from "../billing/plans";
import { capExempt, claimAgentRun } from "../usage/period";
import { connectionFailureService } from "../mcp-server";
import { trackSkillEvent } from "../track";
import { mastraEngine } from "./engine";
import { RUN_EMAIL_SENDER_NAME } from "./notify";
import { runSchedule, type RunDeps } from "./run";
import { drizzleScheduleStore } from "./store";

/**
 * The per-minute tick (SCRUM-225). Claims what is due, runs each schedule
 * in turn, and never lets one user's failure stop another's run.
 *
 * SAFE TO RUN TWICE. The claim in the store is the guarantee: a second
 * process or an overlapping tick advances nothing and runs nothing for a row
 * the first one took. The module flag below only stops one process from
 * stacking ticks on itself while a slow turn is in flight, and its loser
 * logs nothing, because there is nothing to report.
 */

let inFlight = false;

/**
 * The runner's real dependencies. `over` exists for tests and for nothing
 * else: it can replace `baseUrl`, which is the allowlist the run email
 * anchors, so it must never be reachable from a request. It is not: this
 * module is imported by `server.ts` (the cron entrypoint, which passes only
 * the database) and by its own tests, and `scheduler.test.ts` asserts both
 * facts against the source tree so a future importer under `src/app` fails
 * the suite.
 */
export function buildRunDeps(db: Database, over: Partial<RunDeps> = {}): RunDeps {
  const env = getEnv();
  return {
    store: drizzleScheduleStore(db),
    engine: mastraEngine(db),
    claim: async (userId) => {
      const [row] = await db.select({ plan: users.plan }).from(users).where(eq(users.id, userId)).limit(1);
      const cap = (await capExempt(db, userId)) ? null : planLimits(row?.plan ?? "free").agentRuns;
      return claimAgentRun(db, userId, cap);
    },
    user: async (userId) => {
      const [row] = await db
        .select({ email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return row ? { email: row.email, name: row.name ?? null } : null;
    },
    sendEmail: async (email) => {
      if (!hasBrevoKey()) {
        console.log("[skills] email not configured; run recorded as thread_only");
        return false;
      }
      return sendBrevoEmail({
        to: email.to,
        ...(email.toName ? { toName: email.toName } : {}),
        subject: email.subject,
        textContent: email.text,
        htmlContent: email.html,
        senderEmail: env.LEADS_CONFIRMATION_FROM,
        senderName: RUN_EMAIL_SENDER_NAME,
      });
    },
    track: (event, userId, props) => {
      void trackSkillEvent(db, userId, event, props);
    },
    connectionFailure: connectionFailureService,
    baseUrl: env.PUBLIC_APP_URL.replace(/\/$/, ""),
    now: () => new Date(),
    ...over,
  };
}

export async function runDueSchedules(
  db: Database,
  opts: { now?: Date; deps?: Partial<RunDeps> } = {}
): Promise<{ claimed: number; ran: number }> {
  if (inFlight) return { claimed: 0, ran: 0 };
  inFlight = true;
  try {
    const deps = buildRunDeps(db, opts.deps);
    const now = opts.now ?? deps.now();
    const due = await deps.store.claimDue(now);
    let ran = 0;
    for (const schedule of due) {
      const skill = getSkillBySlug(schedule.skillSlug);
      if (!skill) {
        // A schedule for a skill that left the catalogue: pause it with the
        // failure reason rather than run nothing forever in silence.
        await deps.store.patchSchedule(schedule.id, { paused: true, pausedReason: "failures" });
        console.warn(`[skills] schedule ${schedule.id} names an unpublished skill; paused`);
        continue;
      }
      try {
        const report = await runSchedule(schedule, skill, deps);
        ran += 1;
        console.log(
          `[skills] scheduled run ${report.runRowId} for ${schedule.skillSlug}: ${report.status}, ${report.delivered}`
        );
      } catch (err) {
        // The runner records every outcome it knows about; this is the one it
        // does not, a failure of the recording itself. Log and continue to the
        // next user's schedule.
        console.error(`[skills] scheduled run for schedule ${schedule.id} crashed`, err);
      }
    }
    return { claimed: due.length, ran };
  } finally {
    inFlight = false;
  }
}
