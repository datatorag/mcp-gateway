import { describe, expect, it, vi, beforeEach } from "vitest";
import { readSkillFiles } from "@/lib/skills";
import { classifyRun, runSchedule, MAX_CONSECUTIVE_FAILURES, type RunDeps } from "./run";
import { memoryScheduleStore, type ScheduleRow } from "./store";

/* SCRUM-225: one scheduled run, from claim to history row to the one email.
 * The engine, the claim, the mail and the clock are injected; the store is
 * the in-memory one, so every branch of the outcome table is pinned here
 * without a model or a database. */

const skill = readSkillFiles().find((s) => s.slug === "morning-brief")!;
const NOW = new Date("2026-09-09T14:00:00Z");

function schedule(over: Partial<ScheduleRow> = {}): ScheduleRow {
  return {
    id: "sched-1",
    userId: "user-1",
    skillSlug: "morning-brief",
    cadence: "daily",
    hour: 7,
    minute: 0,
    weekday: null,
    timezone: "America/Los_Angeles",
    paused: false,
    pausedReason: null,
    consecutiveFailures: 0,
    lastRunAt: null,
    nextRunAt: NOW,
    ...over,
  };
}

const NOT_CONNECTED = "google-workspace is not connected. Please connect it from the dashboard.";

function deps(over: Partial<RunDeps> = {}) {
  const store = memoryScheduleStore([schedule()]);
  const sendEmail = vi.fn().mockResolvedValue(true);
  const track = vi.fn();
  const d: RunDeps = {
    store,
    engine: vi.fn().mockResolvedValue({ text: "Brief sent.", toolCalls: [] }),
    claim: vi.fn().mockResolvedValue({ ok: true, used: 1, remaining: 9 }),
    user: vi.fn().mockResolvedValue({ email: "user@example.com", name: "Sam" }),
    sendEmail,
    track,
    connectionFailure: (text) => (text.includes("is not connected") ? "google-workspace" : null),
    baseUrl: "https://example.com",
    now: () => NOW,
    ...over,
  };
  return { d, store, sendEmail, track };
}

const call = (toolName: string, resultText = "ok", isError = false) => ({ toolName, resultText, isError });

beforeEach(() => vi.clearAllMocks());

describe("classifyRun", () => {
  it("counts tool calls by name and notices when the skill mailed the user itself", () => {
    const c = classifyRun(
      {
        text: "done",
        toolCalls: [call("gws-mcp__gmail_search"), call("gws-mcp__gmail_search"), call("gws-mcp__gmail_send")],
      },
      () => null
    );
    expect(c.status).toBe("succeeded");
    expect(c.toolCalls).toEqual({ "gws-mcp__gmail_search": 2, "gws-mcp__gmail_send": 1 });
    expect(c.toolCallCount).toBe(3);
    expect(c.selfDelivered).toBe(true);
  });

  it("is a reconnect outcome when any tool answered that a service is not connected", () => {
    const c = classifyRun(
      { text: "I could not read your mail.", toolCalls: [call("gws-mcp__gmail_search", NOT_CONNECTED, true)] },
      (text) => (text.includes("is not connected") ? "google-workspace" : null)
    );
    expect(c.status).toBe("reconnect");
    expect(c.service).toBe("google-workspace");
    expect(c.selfDelivered).toBe(false);
  });
});

describe("runSchedule: the outcome table", () => {
  it("succeeded without self-delivery: history row, allowance claimed, thread, ONE notification email", async () => {
    const { d, store, sendEmail, track } = deps();
    const report = await runSchedule(schedule(), skill, d);
    expect(report.status).toBe("succeeded");
    expect(d.claim).toHaveBeenCalledWith("user-1");
    expect(d.engine).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", skill, threadId: expect.any(String), runId: expect.any(String), timezone: "America/Los_Angeles" })
    );
    const run = store.runs[0]!;
    expect(run).toMatchObject({ status: "succeeded", delivered: "notification_email", threadId: report.threadId });
    expect(run.finishedAt).toEqual(NOW);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const email = sendEmail.mock.calls[0]![0];
    expect(email.to).toBe("user@example.com");
    expect(email.text).toContain(`https://example.com/dashboard/agent?thread=${report.threadId}`);
    expect(store.schedules[0]).toMatchObject({ paused: false, consecutiveFailures: 0, lastRunAt: NOW });
    expect(track).toHaveBeenCalledWith(
      "skill_run_finished",
      "user-1",
      expect.objectContaining({ skill: "morning-brief", trigger: "scheduled", status: "succeeded", delivered: "notification_email" })
    );
    expect(track).toHaveBeenCalledWith(
      "skill_run_started",
      "user-1",
      expect.objectContaining({ skill: "morning-brief", trigger: "scheduled", surface: "scheduler" })
    );
  });

  it("succeeded WITH self-delivery: the skill's own email is the delivery and no notification is sent", async () => {
    const { d, store, sendEmail } = deps({
      engine: vi.fn().mockResolvedValue({ text: "Sent you the brief.", toolCalls: [call("gws-mcp__gmail_send")] }),
    });
    await runSchedule(schedule(), skill, d);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(store.runs[0]).toMatchObject({ status: "succeeded", delivered: "skill_email", toolCallCount: 1 });
  });

  it("refused by the allowance: a row that says so, the schedule pauses, ONE email, no engine call", async () => {
    const { d, store, sendEmail, track } = deps({ claim: vi.fn().mockResolvedValue({ ok: false, used: 10 }) });
    const report = await runSchedule(schedule(), skill, d);
    expect(report.status).toBe("refused");
    expect(d.engine).not.toHaveBeenCalled();
    expect(store.runs[0]).toMatchObject({ status: "refused", delivered: "notification_email" });
    expect(store.schedules[0]).toMatchObject({ paused: true, pausedReason: "allowance" });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0]![0].text).toContain("https://example.com/dashboard/billing");
    expect(track).toHaveBeenCalledWith(
      "skill_schedule_paused",
      "user-1",
      expect.objectContaining({ skill: "morning-brief", by: "system", reason: "allowance" })
    );
  });

  it("reconnect needed: the first failing tool call pauses the schedule with the service named, ONE email with the connect link", async () => {
    const { d, store, sendEmail } = deps({
      engine: vi.fn().mockResolvedValue({
        text: "I could not reach your mail.",
        toolCalls: [call("gws-mcp__gmail_search", NOT_CONNECTED, true)],
      }),
    });
    const report = await runSchedule(schedule(), skill, d);
    expect(report.status).toBe("reconnect");
    expect(store.schedules[0]).toMatchObject({ paused: true, pausedReason: "reconnect" });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const email = sendEmail.mock.calls[0]![0];
    expect(email.text).toContain("https://example.com/dashboard/connections");
    expect(email.text).toContain("Google Workspace");
  });

  it("a failed turn counts one failure and emails once; the third consecutive failure pauses the schedule", async () => {
    const { d, store, sendEmail, track } = deps({
      engine: vi.fn().mockRejectedValue(new Error("provider unavailable")),
    });
    await runSchedule(schedule(), skill, d);
    expect(store.runs[0]).toMatchObject({ status: "failed", error: "provider unavailable" });
    expect(store.schedules[0]).toMatchObject({ paused: false, consecutiveFailures: 1 });
    expect(sendEmail).toHaveBeenCalledTimes(1);

    await runSchedule(schedule({ consecutiveFailures: MAX_CONSECUTIVE_FAILURES - 1 }), skill, d);
    expect(store.schedules[0]).toMatchObject({ paused: true, pausedReason: "failures", consecutiveFailures: 3 });
    expect(track).toHaveBeenCalledWith(
      "skill_schedule_paused",
      "user-1",
      expect.objectContaining({ by: "system", reason: "failures" })
    );
  });

  it("a run that FAILED after the skill already mailed the user gets exactly one message, ours, never two", async () => {
    // The skill sent its email, then a later tool threw and the turn failed.
    // The user must hear that the run failed (the skill's own mail cannot say
    // so), and must not hear it twice.
    const engine = vi.fn().mockImplementation(async () => {
      const err = Object.assign(new Error("calendar timed out"), {
        toolCalls: [call("gws-mcp__gmail_send"), call("gws-mcp__calendar_list_events", "timeout", true)],
      });
      throw err;
    });
    const { d, store, sendEmail } = deps({ engine });
    await runSchedule(schedule(), skill, d);
    expect(store.runs[0]).toMatchObject({ status: "failed", delivered: "notification_email" });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0]![0].subject).toContain("did not finish");
  });

  it("the email refuses to be a second failure: a send that fails records thread_only and the run still completes", async () => {
    const { d, store } = deps({ sendEmail: vi.fn().mockResolvedValue(false) });
    const report = await runSchedule(schedule(), skill, d);
    expect(report.status).toBe("succeeded");
    expect(store.runs[0]).toMatchObject({ delivered: "thread_only" });
  });

  it("a success resets the failure count", async () => {
    const { d, store } = deps();
    await runSchedule(schedule({ consecutiveFailures: 2 }), skill, d);
    expect(store.schedules[0]).toMatchObject({ consecutiveFailures: 0, paused: false });
  });
});
