import { and, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import {
  SCHEDULE_CADENCES,
  skillRuns,
  skillSchedules,
  type Delivery,
  type PauseReason,
  type RunStatus,
  type ScheduleCadence,
} from "@datatorag-mcp/db";
import { getSkillBySlug, servicesFor } from "@/lib/skills";
import { listConnectedServiceIds } from "../connected-services";
import { isValidTimezone, nextRunAt } from "./schedule-time";

/**
 * A user's schedules (SCRUM-225): create for a skill they can run, list with
 * history, pause, resume, delete. Ownership is in every WHERE, so a foreign
 * id and an unknown id are the same null.
 */

export type ScheduleInput = {
  slug: string;
  cadence: ScheduleCadence;
  hour: number;
  minute: number;
  weekday: number | null;
  timezone: string;
};

export type RunView = {
  id: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  threadId: string | null;
  delivered: Delivery | null;
  toolCallCount: number;
  error: string | null;
};

export type ScheduleView = {
  id: string;
  skillSlug: string;
  title: string;
  cadence: ScheduleCadence;
  hour: number;
  minute: number;
  weekday: number | null;
  timezone: string;
  paused: boolean;
  pausedReason: PauseReason | null;
  consecutiveFailures: number;
  lastRunAt: string | null;
  nextRunAt: string;
  runs: RunView[];
};

export const HISTORY_LIMIT = 10;
const SLUG = /^[a-z0-9-]{1,80}$/;

function isInt(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

/** Validates a request body into a ScheduleInput, or says what is wrong.
 * Pure, and the only place the shape is read, so the route and the module
 * agree by construction. */
export function validateScheduleInput(
  body: unknown
): { ok: true; value: ScheduleInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "body must be an object" };
  const b = body as Record<string, unknown>;
  if (typeof b.slug !== "string" || !SLUG.test(b.slug)) return { ok: false, error: "slug" };
  if (typeof b.cadence !== "string" || !(SCHEDULE_CADENCES as readonly string[]).includes(b.cadence)) {
    return { ok: false, error: "cadence" };
  }
  if (!isInt(b.hour, 0, 23)) return { ok: false, error: "hour" };
  const minute = b.minute === undefined ? 0 : b.minute;
  if (!isInt(minute, 0, 59)) return { ok: false, error: "minute" };
  const weekday = b.weekday === undefined ? null : b.weekday;
  if (weekday !== null && !isInt(weekday, 0, 6)) return { ok: false, error: "weekday" };
  if (b.cadence === "weekly" && weekday === null) return { ok: false, error: "weekday" };
  if (typeof b.timezone !== "string" || !isValidTimezone(b.timezone)) return { ok: false, error: "timezone" };
  return {
    ok: true,
    value: {
      slug: b.slug,
      cadence: b.cadence as ScheduleCadence,
      hour: b.hour,
      minute,
      weekday: b.cadence === "weekly" ? weekday : null,
      timezone: b.timezone,
    },
  };
}

type ScheduleRecord = typeof skillSchedules.$inferSelect;

function toView(row: ScheduleRecord, runs: RunView[]): ScheduleView {
  return {
    id: row.id,
    skillSlug: row.skillSlug,
    title: getSkillBySlug(row.skillSlug)?.title ?? row.skillSlug,
    cadence: row.cadence,
    hour: row.hour,
    minute: row.minute,
    weekday: row.weekday,
    timezone: row.timezone,
    paused: row.paused,
    pausedReason: row.pausedReason,
    consecutiveFailures: row.consecutiveFailures,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    nextRunAt: row.nextRunAt.toISOString(),
    runs,
  };
}

async function historyFor(db: Database, scheduleIds: string[]): Promise<Map<string, RunView[]>> {
  const byId = new Map<string, RunView[]>();
  if (scheduleIds.length === 0) return byId;
  const rows = await db
    .select()
    .from(skillRuns)
    .where(inArray(skillRuns.scheduleId, scheduleIds))
    .orderBy(desc(skillRuns.startedAt));
  for (const r of rows) {
    const list = byId.get(r.scheduleId) ?? [];
    if (list.length >= HISTORY_LIMIT) continue;
    list.push({
      id: r.id,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      threadId: r.threadId,
      delivered: r.delivered,
      toolCallCount: r.toolCallCount,
      error: r.error,
    });
    byId.set(r.scheduleId, list);
  }
  return byId;
}

export async function listSchedulesForUser(db: Database, userId: string): Promise<ScheduleView[]> {
  const rows = await db
    .select()
    .from(skillSchedules)
    .where(eq(skillSchedules.userId, userId))
    .orderBy(skillSchedules.createdAt);
  const history = await historyFor(
    db,
    rows.map((r) => r.id)
  );
  return rows.map((r) => toView(r, history.get(r.id) ?? []));
}

export type CreateResult =
  | { ok: true; schedule: ScheduleView }
  | { ok: false; reason: "unknown_skill" }
  | { ok: false; reason: "not_connected"; missing: string[] }
  | { ok: false; reason: "exists" };

/** A schedule only for a published skill whose services this user has
 * connected: a schedule that cannot run is a paused schedule with extra
 * steps, so the refusal happens here, naming what is missing. */
export async function createSchedule(
  db: Database,
  userId: string,
  input: ScheduleInput,
  now: Date = new Date()
): Promise<CreateResult> {
  const skill = getSkillBySlug(input.slug);
  if (!skill) return { ok: false, reason: "unknown_skill" };
  const connected = await listConnectedServiceIds(db, userId);
  const missing = servicesFor(skill).filter((s) => !connected.has(s));
  if (missing.length > 0) return { ok: false, reason: "not_connected", missing };

  const [existing] = await db
    .select({ id: skillSchedules.id })
    .from(skillSchedules)
    .where(and(eq(skillSchedules.userId, userId), eq(skillSchedules.skillSlug, skill.slug)))
    .limit(1);
  if (existing) return { ok: false, reason: "exists" };

  try {
    const [row] = await db
      .insert(skillSchedules)
      .values({
        userId,
        skillSlug: skill.slug,
        cadence: input.cadence,
        hour: input.hour,
        minute: input.minute,
        weekday: input.weekday,
        timezone: input.timezone,
        nextRunAt: nextRunAt(input, now),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return { ok: true, schedule: toView(row!, []) };
  } catch (err) {
    // The unique key caught a race the pre-check did not; same answer.
    if ((err as { code?: string })?.code === "23505") return { ok: false, reason: "exists" };
    throw err;
  }
}

/** Pause is one click. Resume is explicit and clears everything the runner
 * set: the reason, the failure count, and it recomputes the next run from
 * now, so a schedule paused for a week does not fire the moment it resumes. */
export async function setSchedulePaused(
  db: Database,
  userId: string,
  id: string,
  paused: boolean,
  now: Date = new Date()
): Promise<ScheduleView | null> {
  const [row] = await db
    .select()
    .from(skillSchedules)
    .where(and(eq(skillSchedules.id, id), eq(skillSchedules.userId, userId)))
    .limit(1);
  if (!row) return null;
  const patch = paused
    ? { paused: true, pausedReason: "user" as const, updatedAt: now }
    : {
        paused: false,
        pausedReason: null,
        consecutiveFailures: 0,
        nextRunAt: nextRunAt(row, now),
        updatedAt: now,
      };
  const [updated] = await db
    .update(skillSchedules)
    .set(patch)
    .where(and(eq(skillSchedules.id, id), eq(skillSchedules.userId, userId)))
    .returning();
  if (!updated) return null;
  const history = await historyFor(db, [id]);
  return toView(updated, history.get(id) ?? []);
}

export async function deleteSchedule(
  db: Database,
  userId: string,
  id: string
): Promise<{ skillSlug: string } | null> {
  const [row] = await db
    .delete(skillSchedules)
    .where(and(eq(skillSchedules.id, id), eq(skillSchedules.userId, userId)))
    .returning({ skillSlug: skillSchedules.skillSlug });
  return row ?? null;
}
