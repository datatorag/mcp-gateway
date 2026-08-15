import { describe, it, expect } from "vitest";
import { PLAN_VALUES } from "@datatorag-mcp/db";
import {
  planLimits,
  isOverage,
  FREE_MONTHLY_CAP,
  PRO_MONTHLY_INCLUDED,
  FREE_MONTHLY_AGENT_RUNS,
  RUN_TOKEN_CEILING,
} from "./plans";

describe("planLimits", () => {
  it("free has a hard cap", () => {
    expect(planLimits("free")).toEqual({
      monthlyIncluded: FREE_MONTHLY_CAP,
      hardCap: true,
      multiAccount: true,
      agentRuns: FREE_MONTHLY_AGENT_RUNS,
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
  it("payg has 0 included, no hard cap, and the free run allowance", () => {
    expect(planLimits("payg")).toEqual({
      monthlyIncluded: 0,
      hardCap: false,
      multiAccount: true,
      agentRuns: FREE_MONTHLY_AGENT_RUNS,
    });
  });
  it("the agent-run allowance is PER PLAN: free 25, pro 100, everything else free (SCRUM-84)", () => {
    // This REVERSES the earlier "no per-plan agent allowance" pin, on the
    // terms that pin set for itself: it existed to make a per-plan allowance
    // a decision rather than a drift, and the blocker it named — "no measured
    // ceiling behind it" — is gone. The per-run token distribution was
    // measured (SCRUM-55) and RUN_TOKEN_CEILING now bounds the tail, so
    // allowance x ceiling bounds each subscriber's worst-case model cost.
    // Before this, Pro shipped capped at the SAME 25 runs as Free — a paying
    // subscriber getting exactly what the free tier gets, which is a broken
    // promise rather than generosity.
    expect(planLimits("free").agentRuns).toBe(FREE_MONTHLY_AGENT_RUNS);
    expect(planLimits("pro").agentRuns).toBe(100);
    // Least privilege everywhere else: nothing that is not "pro" may claim
    // like Pro, unknown values included.
    expect(planLimits("payg").agentRuns).toBe(FREE_MONTHLY_AGENT_RUNS);
    expect(
      planLimits("plan-from-the-future" as (typeof PLAN_VALUES)[number]).agentRuns
    ).toBe(FREE_MONTHLY_AGENT_RUNS);
  });
  it("the per-run token ceiling is the ruled 150k, just above the measured p95", () => {
    // The number the cost bound was computed with. If this changes, the
    // allowance math in the pro branch comment changes with it — move both.
    expect(RUN_TOKEN_CEILING).toBe(150_000);
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
