import { beforeEach, describe, expect, it, vi } from "vitest";

/* SCRUM-242: a scheduled run is handed its clock in the schedule's own zone,
 * the one the user chose when they made it. The runtime is mocked to the one
 * call the engine makes; what is judged is the text it receives. */

const generate = vi.fn();
vi.mock("@/mastra", () => ({
  getMastra: () => ({ getAgent: () => ({ generate: (...a: unknown[]) => generate(...a) }) }),
  DATATORAG_AGENT_ID: "datatorag-playground",
}));
vi.mock("../connected-accounts", () => ({
  listConnectedAccounts: async () => [
    { connectorType: "google-workspace", accountEmail: "me@example.com", isDefault: true },
  ],
}));
vi.mock("../playground/threads", () => ({ setThreadTitleIfEmpty: async () => {} }));
vi.mock("../track", () => ({ trackAgentRun: () => {} }));

import { readSkillFiles, runAccountsFrom, runClockLine, skillRunMessage } from "@/lib/skills";
import { mastraEngine } from "./engine";

describe("mastraEngine and the run clock (SCRUM-242)", () => {
  const skill = readSkillFiles().find((s) => s.slug === "morning-brief")!;
  const accounts = runAccountsFrom([
    { connectorType: "google-workspace", accountEmail: "me@example.com", isDefault: true },
  ]);

  beforeEach(() => {
    generate.mockReset();
    generate.mockResolvedValue({ text: "Brief sent.", steps: [] });
  });

  it("hands the runtime the run message ending with the clock in the schedule's zone", async () => {
    const engine = mastraEngine({} as never);
    const before = new Date();
    await engine({ userId: "user-1", skill, threadId: "t1", runId: "r1", timezone: "Asia/Tokyo" });
    const text = generate.mock.calls[0]![0] as string;
    expect(text.startsWith(skillRunMessage(skill, accounts))).toBe(true);
    const m = text.match(/\n\nRun started (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)\. The user's time zone is Asia\/Tokyo, where it is /);
    expect(m).not.toBeNull();
    expect(Date.parse(m![1]!)).toBeGreaterThanOrEqual(Math.floor(before.getTime() / 1000) * 1000);
    // The same line the message builder produces for that clock.
    const started = new Date(m![1]!);
    expect(text.endsWith("\n\n" + runClockLine({ now: started, zone: "Asia/Tokyo" }))).toBe(true);
  });

  it("says the zone is not known when the schedule has none", async () => {
    const engine = mastraEngine({} as never);
    await engine({ userId: "user-1", skill, threadId: "t1", runId: "r1" });
    expect(generate.mock.calls[0]![0] as string).toMatch(/Run started .* time zone is not known/);
  });
});
