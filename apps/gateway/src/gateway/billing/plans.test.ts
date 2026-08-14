import { describe, it, expect } from "vitest";
import { PLAN_VALUES } from "@datatorag-mcp/db";
import { planLimits, isOverage, FREE_MONTHLY_CAP, PRO_MONTHLY_INCLUDED } from "./plans";

describe("planLimits", () => {
  it("free has a hard cap", () => {
    expect(planLimits("free")).toEqual({
      monthlyIncluded: FREE_MONTHLY_CAP,
      hardCap: true,
      multiAccount: true,
    });
  });
  it("multi-account is included on Free — ruled 2026-08-07, advertised on /pricing", () => {
    // The pricing page promises multi-account in every tier, twice. This test
    // exists so that flipping the flag back to false is a deliberate decision
    // that has to delete this sentence, not a drive-by "free means less".
    for (const plan of PLAN_VALUES) {
      expect(planLimits(plan).multiAccount, `multiAccount on ${plan}`).toBe(true);
    }
  });
  it("pro has the raised allowance and no hard stop", () => {
    expect(planLimits("pro").monthlyIncluded).toBe(PRO_MONTHLY_INCLUDED);
    expect(planLimits("pro").hardCap).toBe(false);
  });
  it("payg has 0 included, no hard cap", () => {
    expect(planLimits("payg")).toEqual({
      monthlyIncluded: 0,
      hardCap: false,
      multiAccount: true,
    });
  });
  it("plan limits carry NO agent-run allowance — the run cap is plan-independent", () => {
    // The cost asymmetry: gateway calls run on the user's own upstream quota
    // and cost us almost nothing, while agent runs burn our model budget. Pro
    // therefore raises the CALL allowance only; the agent-run cap is the same
    // number on every tier (see FREE_MONTHLY_AGENT_RUNS and the playground
    // chat route, which deliberately never consults the plan). If a per-plan
    // agent allowance ever lands here, that is an unbounded per-subscriber
    // cost with no measured ceiling behind it — this test is meant to make
    // that a decision, not a drift.
    for (const plan of PLAN_VALUES) {
      expect(Object.keys(planLimits(plan)).sort()).toEqual([
        "hardCap",
        "monthlyIncluded",
        "multiAccount",
      ]);
    }
  });
});

describe("isOverage", () => {
  it("free goes over one past its allowance", () => {
    // Derived from the constant, not restated. Restating it is how the value
    // here and the decided value drifted apart unnoticed: nothing imported
    // this module, so a test agreeing with a stale number looked like proof.
    expect(isOverage("free", FREE_MONTHLY_CAP)).toBe(false);
    expect(isOverage("free", FREE_MONTHLY_CAP + 1)).toBe(true);
  });
  it("pro goes over one past its allowance", () => {
    expect(isOverage("pro", PRO_MONTHLY_INCLUDED)).toBe(false);
    expect(isOverage("pro", PRO_MONTHLY_INCLUDED + 1)).toBe(true);
  });
  it("payg meters every call", () => {
    expect(isOverage("payg", 1)).toBe(true);
  });
});
