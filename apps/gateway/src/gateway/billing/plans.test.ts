import { describe, it, expect } from "vitest";
import { planLimits, isOverage, FREE_MONTHLY_CAP, PRO_MONTHLY_INCLUDED } from "./plans";

describe("planLimits", () => {
  it("free has hard cap at 50", () => {
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
  it("free goes over at 51", () => {
    expect(isOverage("free", 50)).toBe(false);
    expect(isOverage("free", 51)).toBe(true);
  });
  it("pro goes over at 2001", () => {
    expect(isOverage("pro", 2000)).toBe(false);
    expect(isOverage("pro", 2001)).toBe(true);
  });
  it("payg meters every call", () => {
    expect(isOverage("payg", 1)).toBe(true);
  });
});
