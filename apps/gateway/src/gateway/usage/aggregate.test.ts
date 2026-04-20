import { describe, it, expect } from "vitest";
import { percentile, avg, timeBuckets } from "./aggregate";

describe("percentile", () => {
  it("returns 0 for empty array", () => {
    expect(percentile([], 50)).toBe(0);
  });
  it("returns single value for single-element array", () => {
    expect(percentile([42], 95)).toBe(42);
  });
  it("computes p50 of sorted list", () => {
    expect(percentile([10, 20, 30, 40, 50], 50)).toBe(30);
  });
  it("computes p95 of sorted list", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
  });
  it("handles unsorted input", () => {
    expect(percentile([50, 10, 30, 40, 20], 50)).toBe(30);
  });
});

describe("avg", () => {
  it("returns 0 for empty array", () => {
    expect(avg([])).toBe(0);
  });
  it("computes mean", () => {
    expect(avg([10, 20, 30])).toBe(20);
  });
});

describe("timeBuckets", () => {
  it("returns hourly buckets for a 24h range", () => {
    const start = new Date("2026-04-20T00:00:00Z");
    const end = new Date("2026-04-21T00:00:00Z");
    const buckets = timeBuckets(start, end);
    expect(buckets.granularity).toBe("hour");
    expect(buckets.count).toBe(24);
  });
  it("returns daily buckets for 7d range", () => {
    const start = new Date("2026-04-13T00:00:00Z");
    const end = new Date("2026-04-20T00:00:00Z");
    const buckets = timeBuckets(start, end);
    expect(buckets.granularity).toBe("day");
    expect(buckets.count).toBe(7);
  });
  it("returns daily buckets for 30d range", () => {
    const start = new Date("2026-03-21T00:00:00Z");
    const end = new Date("2026-04-20T00:00:00Z");
    const buckets = timeBuckets(start, end);
    expect(buckets.granularity).toBe("day");
    expect(buckets.count).toBe(30);
  });
});
