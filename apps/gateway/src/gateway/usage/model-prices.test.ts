import { describe, expect, it } from "vitest";

import {
  costUsd,
  MODEL_PRICES,
  PRICES_AS_OF,
  SELECTABLE_MODELS,
  type ModelPrice,
} from "./model-prices";

/**
 * SCRUM-257: one price table, ours to maintain. A model the agent can run
 * without a price row would cost zero on every surface and nobody would
 * notice, so the table is pinned against the selectable list here.
 */
describe("the model price table (SCRUM-257)", () => {
  it("carries the date the prices were read, as a calendar date", () => {
    expect(PRICES_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(PRICES_AS_OF))).toBe(false);
  });

  it("has a row for every model the agent can select, and for the configured default", () => {
    for (const model of SELECTABLE_MODELS) {
      expect(MODEL_PRICES[model], model).toBeDefined();
    }
    // The default the environment schema falls back to when nothing is set.
    expect(SELECTABLE_MODELS).toContain("claude-sonnet-5");
  });

  it("every row prices all four buckets as positive USD per million tokens", () => {
    for (const [model, price] of Object.entries(MODEL_PRICES) as Array<[string, ModelPrice]>) {
      for (const bucket of ["inputPerM", "outputPerM", "cacheReadPerM", "cacheWritePerM"] as const) {
        expect(price[bucket], `${model}.${bucket}`).toBeGreaterThan(0);
      }
      // A cache read is cheaper than fresh input, and a cache write dearer.
      expect(price.cacheReadPerM).toBeLessThan(price.inputPerM);
      expect(price.cacheWritePerM).toBeGreaterThan(price.inputPerM);
    }
  });

  it("prices a run bucket by bucket, in dollars, rounded to a millionth", () => {
    const sonnet = MODEL_PRICES["claude-sonnet-5"]!;
    expect(costUsd("claude-sonnet-5", { input: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 0 })).toBe(sonnet.inputPerM);
    expect(costUsd("claude-sonnet-5", { input: 0, cacheRead: 1_000_000, cacheWrite: 0, output: 0 })).toBe(sonnet.cacheReadPerM);
    expect(costUsd("claude-sonnet-5", { input: 0, cacheRead: 0, cacheWrite: 1_000_000, output: 0 })).toBe(sonnet.cacheWritePerM);
    expect(costUsd("claude-sonnet-5", { input: 0, cacheRead: 0, cacheWrite: 0, output: 1_000_000 })).toBe(sonnet.outputPerM);
    const mixed = costUsd("claude-sonnet-5", { input: 14, cacheRead: 303_511, cacheWrite: 80_858, output: 72_876 })!;
    const expected =
      (14 * sonnet.inputPerM + 303_511 * sonnet.cacheReadPerM + 80_858 * sonnet.cacheWritePerM + 72_876 * sonnet.outputPerM) /
      1_000_000;
    expect(mixed).toBeCloseTo(expected, 6);
    expect(mixed).toBeGreaterThan(0.5);
    expect(mixed).toBeLessThan(2);
  });

  it("answers null, not zero, for a model with no row: an unpriced run must not read as free", () => {
    expect(costUsd("some-other-model", { input: 1000, cacheRead: 0, cacheWrite: 0, output: 10 })).toBeNull();
  });

  it("an empty run costs nothing", () => {
    expect(costUsd("claude-sonnet-5", { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 })).toBe(0);
  });
});
