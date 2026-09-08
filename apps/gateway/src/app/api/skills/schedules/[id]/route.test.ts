import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/* SCRUM-225: pause, resume and delete one schedule. Ownership is the
 * module's; the route pins that a foreign or unknown id is one
 * indistinguishable 404, and that each change reports its event. */

vi.mock("@/lib/session", () => ({ getSessionUserId: vi.fn().mockResolvedValue("user-1") }));
vi.mock("@/lib/db", () => ({ db: {} }));
const setSchedulePaused = vi.fn();
const deleteSchedule = vi.fn();
vi.mock("@/gateway/skills/schedules", () => ({
  setSchedulePaused: (...a: unknown[]) => setSchedulePaused(...a),
  deleteSchedule: (...a: unknown[]) => deleteSchedule(...a),
}));
const trackSkillEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/gateway/track", () => ({ trackSkillEvent: (...a: unknown[]) => trackSkillEvent(...a) }));

const { PATCH, DELETE } = await import("./route");

const S1 = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (body?: unknown) =>
  ({
    json: async () => body,
    headers: new Headers(),
    nextUrl: new URL("http://localhost/api/skills/schedules/s-1"),
  }) as unknown as NextRequest;

const VIEW = { id: "s-1", skillSlug: "morning-brief", paused: true, pausedReason: "user" };

beforeEach(() => {
  vi.clearAllMocks();
  setSchedulePaused.mockResolvedValue(VIEW);
  deleteSchedule.mockResolvedValue({ skillSlug: "morning-brief" });
});

describe("PATCH /api/skills/schedules/[id]", () => {
  it("pauses with { paused: true } and reports skill_schedule_paused by the user", async () => {
    const res = await PATCH(req({ paused: true }), ctx(S1));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ schedule: VIEW });
    expect(setSchedulePaused).toHaveBeenCalledWith({}, "user-1", S1, true);
    expect(trackSkillEvent).toHaveBeenCalledWith(
      {},
      "user-1",
      "skill_schedule_paused",
      expect.objectContaining({ skill: "morning-brief", by: "user", reason: "user" })
    );
  });

  it("resumes with { paused: false } and reports skill_schedule_resumed", async () => {
    setSchedulePaused.mockResolvedValueOnce({ ...VIEW, paused: false, pausedReason: null });
    const res = await PATCH(req({ paused: false }), ctx(S1));
    expect(res.status).toBe(200);
    expect(trackSkillEvent).toHaveBeenCalledWith({}, "user-1", "skill_schedule_resumed", expect.objectContaining({ skill: "morning-brief" }));
  });

  it("refuses a body without a boolean paused", async () => {
    expect((await PATCH(req({ paused: "yes" }), ctx(S1))).status).toBe(400);
    expect((await PATCH(req(undefined), ctx(S1))).status).toBe(400);
    expect(setSchedulePaused).not.toHaveBeenCalled();
  });

  it("is 404 for a schedule that is not the user's or does not exist", async () => {
    setSchedulePaused.mockResolvedValueOnce(null);
    expect((await PATCH(req({ paused: true }), ctx(OTHER))).status).toBe(404);
    expect(trackSkillEvent).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/skills/schedules/[id]", () => {
  it("deletes and reports skill_schedule_deleted", async () => {
    deleteSchedule.mockResolvedValueOnce({ skillSlug: "morning-brief" });
    const res = await DELETE(req(), ctx(S1));
    expect(res.status).toBe(200);
    expect(deleteSchedule).toHaveBeenCalledWith({}, "user-1", S1);
    expect(trackSkillEvent).toHaveBeenCalledWith({}, "user-1", "skill_schedule_deleted", expect.objectContaining({ skill: "morning-brief" }));
  });

  it("is 404 for a foreign or unknown id", async () => {
    deleteSchedule.mockResolvedValueOnce(null);
    expect((await DELETE(req(), ctx(OTHER))).status).toBe(404);
  });

  it("is 404 for a malformed id, before the database is asked", async () => {
    expect((await DELETE(req(), ctx("not-a-uuid"))).status).toBe(404);
    expect((await PATCH(req({ paused: true }), ctx("not-a-uuid"))).status).toBe(404);
    expect(deleteSchedule).not.toHaveBeenCalled();
    expect(setSchedulePaused).not.toHaveBeenCalled();
  });
});
