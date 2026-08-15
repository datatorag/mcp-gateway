import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveUserEmail = vi.fn();
vi.mock("../user-email", () => ({
  resolveUserEmail: (...a: unknown[]) => resolveUserEmail(...a),
}));

const isInternalEmail = vi.fn();
vi.mock("../../lib/brevo", () => ({
  isInternalEmail: (...a: unknown[]) => isInternalEmail(...a),
}));

import { planLimits, FREE_MONTHLY_AGENT_RUNS } from "../billing/plans";
const { agentRunCap } = await import("./period");

/** db stub answering the single plan SELECT the helper makes. */
function stubDb(planRows: Array<{ plan: string }>) {
  return { execute: vi.fn(async () => planRows) } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveUserEmail.mockResolvedValue("someone@example.com");
  isInternalEmail.mockReturnValue(false);
});

describe("agentRunCap — the one shared cap decider", () => {
  it("an exempt internal account has NO cap: null, never a number", async () => {
    resolveUserEmail.mockResolvedValue("founder@example.com");
    isInternalEmail.mockReturnValue(true);
    const db = stubDb([{ plan: "pro" }]);
    expect(await agentRunCap(db, "user-1")).toBeNull();
  });

  it("free resolves to the free allowance", async () => {
    expect(await agentRunCap(stubDb([{ plan: "free" }]), "user-1")).toBe(
      FREE_MONTHLY_AGENT_RUNS
    );
  });

  it("pro resolves to the ruled 100 — the meter's pin, alongside the claim's and the plan table's", async () => {
    // LITERAL, deliberately: this test is the meter-side half of the SCRUM-84
    // regression pin. Setting pro's allowance back to 25 in planLimits must
    // redden this suite too, because the meter is a PERSISTENT on-screen
    // claim and a silent drift here is a broken promise the customer stares
    // at, not a one-off wrong answer.
    const cap = await agentRunCap(stubDb([{ plan: "pro" }]), "user-1");
    expect(cap).toBe(planLimits("pro").agentRuns);
    expect(cap).toBe(100);
  });

  it("unknown plans and missing rows fall to the free allowance", async () => {
    expect(
      await agentRunCap(stubDb([{ plan: "plan-from-the-future" }]), "user-1")
    ).toBe(FREE_MONTHLY_AGENT_RUNS);
    expect(await agentRunCap(stubDb([]), "user-1")).toBe(
      FREE_MONTHLY_AGENT_RUNS
    );
  });
});
