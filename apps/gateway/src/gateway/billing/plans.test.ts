import { describe, it, expect } from "vitest";
import { planLimits, isOverage, FREE_MONTHLY_CAP, PRO_MONTHLY_INCLUDED } from "./plans";

describe("planLimits", () => {
  it("free has a hard cap", () => {
    expect(planLimits("free")).toEqual({
      monthlyIncluded: FREE_MONTHLY_CAP,
      hardCap: true,
      multiAccount: false,
    });
  });
  it("pro and pro_trial share the same limits", () => {
    expect(planLimits("pro")).toEqual(planLimits("pro_trial"));
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
