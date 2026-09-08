import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Database } from "@datatorag-mcp/db";
import { getTestDb, insertTestUser, isDockerAvailable, stopTestDb } from "@/test-utils/db";

/* SCRUM-225: a user's schedules, created only for a skill they can run,
 * listed with their history, paused and resumed, deleted. Ownership is in
 * every WHERE, so the tests use two users and check the stranger sees and
 * changes nothing. Real Postgres: the unique key and the ownership are SQL. */

const connected = vi.fn();
vi.mock("./../connected-services", () => ({
  listConnectedServiceIds: (...a: unknown[]) => connected(...a),
}));

const { createSchedule, deleteSchedule, listSchedulesForUser, setSchedulePaused, validateScheduleInput } =
  await import("./schedules");

const docker = isDockerAvailable();
const NOW = new Date("2026-09-09T14:00:00Z");
const INPUT = { slug: "morning-brief", cadence: "daily" as const, hour: 7, minute: 0, weekday: null, timezone: "America/Los_Angeles" };

describe("validateScheduleInput (pure)", () => {
  it("accepts a well-formed body and normalises what it can", () => {
    const r = validateScheduleInput({ slug: "morning-brief", cadence: "weekly", hour: 9, weekday: 2, timezone: "UTC" });
    expect(r).toEqual({
      ok: true,
      value: { slug: "morning-brief", cadence: "weekly", hour: 9, minute: 0, weekday: 2, timezone: "UTC" },
    });
  });

  it("refuses a bad hour, a bad cadence, a bad zone, a weekly with no weekday, and a missing slug", () => {
    expect(validateScheduleInput({ ...INPUT, hour: 24 }).ok).toBe(false);
    expect(validateScheduleInput({ ...INPUT, cadence: "hourly" }).ok).toBe(false);
    expect(validateScheduleInput({ ...INPUT, timezone: "Mars/Olympus" }).ok).toBe(false);
    expect(validateScheduleInput({ ...INPUT, cadence: "weekly", weekday: null }).ok).toBe(false);
    expect(validateScheduleInput({ ...INPUT, slug: "" }).ok).toBe(false);
    expect(validateScheduleInput(null).ok).toBe(false);
  });
});

describe.skipIf(!docker)("schedules (real Postgres)", () => {
  let db: Database;
  let owner: string;
  let stranger: string;

  beforeAll(async () => {
    db = await getTestDb();
    owner = await insertTestUser(db);
    stranger = await insertTestUser(db);
    connected.mockResolvedValue(new Set(["google-workspace"]));
  }, 120_000);

  afterAll(async () => {
    await stopTestDb();
  });

  it("creates a schedule for a runnable skill with the next run computed, and refuses a second for the same skill", async () => {
    const created = await createSchedule(db, owner, INPUT, NOW);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.schedule).toMatchObject({
      skillSlug: "morning-brief",
      cadence: "daily",
      hour: 7,
      paused: false,
      nextRunAt: "2026-09-10T14:00:00.000Z",
      runs: [],
    });
    const again = await createSchedule(db, owner, INPUT, NOW);
    expect(again).toEqual({ ok: false, reason: "exists" });
  });

  it("refuses an unknown skill and a skill whose service is not connected, naming what is missing", async () => {
    expect(await createSchedule(db, owner, { ...INPUT, slug: "no-such-skill" }, NOW)).toEqual({
      ok: false,
      reason: "unknown_skill",
    });
    const r = await createSchedule(db, owner, { ...INPUT, slug: "retro-page-to-jira-tickets" }, NOW);
    expect(r).toEqual({ ok: false, reason: "not_connected", missing: ["atlassian"] });
  });

  it("lists only the owner's schedules, with title and history", async () => {
    const mine = await listSchedulesForUser(db, owner);
    expect(mine.map((s) => s.skillSlug)).toEqual(["morning-brief"]);
    expect(mine[0]!.title).toContain("morning brief");
    expect(await listSchedulesForUser(db, stranger)).toEqual([]);
  });

  it("pauses and resumes for the owner only; resume clears the reason and failures and recomputes the next run", async () => {
    const [mine] = await listSchedulesForUser(db, owner);
    expect(await setSchedulePaused(db, stranger, mine!.id, true, NOW)).toBeNull();
    const paused = await setSchedulePaused(db, owner, mine!.id, true, NOW);
    expect(paused).toMatchObject({ paused: true, pausedReason: "user" });
    const later = new Date("2026-09-12T20:00:00Z");
    const resumed = await setSchedulePaused(db, owner, mine!.id, false, later);
    expect(resumed).toMatchObject({
      paused: false,
      pausedReason: null,
      consecutiveFailures: 0,
      nextRunAt: "2026-09-13T14:00:00.000Z",
    });
  });

  it("deletes for the owner only", async () => {
    const [mine] = await listSchedulesForUser(db, owner);
    expect(await deleteSchedule(db, stranger, mine!.id)).toBeNull();
    expect(await deleteSchedule(db, owner, mine!.id)).toEqual({ skillSlug: "morning-brief" });
    expect(await listSchedulesForUser(db, owner)).toEqual([]);
  });
});
