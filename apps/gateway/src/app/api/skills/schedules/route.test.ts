import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/* SCRUM-225: the schedules API. Thin over the gateway module, so what is
 * pinned here is the contract: session-gated, validated before it reaches
 * the module, each refusal its own status, and the events with the slug. */

vi.mock("@/lib/session", () => ({ getSessionUserId: vi.fn().mockResolvedValue("user-1") }));
vi.mock("@/lib/db", () => ({ db: {} }));
const createSchedule = vi.fn();
const listSchedulesForUser = vi.fn();
vi.mock("@/gateway/skills/schedules", async (importActual) => {
  const actual = await importActual<typeof import("@/gateway/skills/schedules")>();
  return {
    ...actual,
    createSchedule: (...a: unknown[]) => createSchedule(...a),
    listSchedulesForUser: (...a: unknown[]) => listSchedulesForUser(...a),
  };
});
const trackSkillEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/gateway/track", () => ({ trackSkillEvent: (...a: unknown[]) => trackSkillEvent(...a) }));

const { GET, POST } = await import("./route");

const post = (body: unknown) =>
  ({ json: async () => body, headers: new Headers(), nextUrl: new URL("http://localhost/api/skills/schedules") }) as unknown as NextRequest;
const get = () =>
  ({ headers: new Headers(), nextUrl: new URL("http://localhost/api/skills/schedules") }) as unknown as NextRequest;

const SCHEDULE = {
  id: "s-1",
  skillSlug: "morning-brief",
  title: "Get a morning brief",
  cadence: "daily",
  hour: 7,
  minute: 0,
  weekday: null,
  timezone: "America/Los_Angeles",
  paused: false,
  pausedReason: null,
  consecutiveFailures: 0,
  lastRunAt: null,
  nextRunAt: "2026-09-10T14:00:00.000Z",
  runs: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  listSchedulesForUser.mockResolvedValue([SCHEDULE]);
  createSchedule.mockResolvedValue({ ok: true, schedule: SCHEDULE });
});

describe("GET /api/skills/schedules", () => {
  it("lists the session user's schedules", async () => {
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ schedules: [SCHEDULE] });
    expect(listSchedulesForUser).toHaveBeenCalledWith({}, "user-1");
  });
});

describe("POST /api/skills/schedules", () => {
  it("creates a schedule from a valid body and reports skill_scheduled with the slug", async () => {
    const res = await POST(post({ slug: "morning-brief", cadence: "daily", hour: 7, timezone: "America/Los_Angeles" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ schedule: SCHEDULE });
    expect(createSchedule).toHaveBeenCalledWith(
      {},
      "user-1",
      { slug: "morning-brief", cadence: "daily", hour: 7, minute: 0, weekday: null, timezone: "America/Los_Angeles" }
    );
    expect(trackSkillEvent).toHaveBeenCalledWith(
      {},
      "user-1",
      "skill_scheduled",
      expect.objectContaining({ skill: "morning-brief", cadence: "daily", hour: 7 })
    );
  });

  it("refuses a malformed body before the module sees it", async () => {
    const res = await POST(post({ slug: "morning-brief", cadence: "daily", hour: 99, timezone: "UTC" }));
    expect(res.status).toBe(400);
    expect(createSchedule).not.toHaveBeenCalled();
  });

  it("maps each module refusal to its own status: unknown skill 404, not connected 409 with the missing services, exists 409", async () => {
    createSchedule.mockResolvedValueOnce({ ok: false, reason: "unknown_skill" });
    expect((await POST(post({ slug: "x", cadence: "daily", hour: 7, timezone: "UTC" }))).status).toBe(404);
    createSchedule.mockResolvedValueOnce({ ok: false, reason: "not_connected", missing: ["atlassian"] });
    const nc = await POST(post({ slug: "retro-page-to-jira-tickets", cadence: "daily", hour: 7, timezone: "UTC" }));
    expect(nc.status).toBe(409);
    expect(await nc.json()).toEqual({ error: "not_connected", missing: ["atlassian"] });
    createSchedule.mockResolvedValueOnce({ ok: false, reason: "exists" });
    expect((await POST(post({ slug: "morning-brief", cadence: "daily", hour: 7, timezone: "UTC" }))).status).toBe(409);
    expect(trackSkillEvent).not.toHaveBeenCalled();
  });
});
