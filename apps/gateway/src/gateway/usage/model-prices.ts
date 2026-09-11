/**
 * The one price table (SCRUM-257): what a model's tokens cost, in USD per
 * million, for the four buckets the provider bills. Ours to maintain: the
 * numbers are read from the provider's public price list on the date below
 * and go stale silently the day it changes, which is why the date is here
 * and why the table lives in one place. The model selector (SCRUM-252)
 * extends SELECTABLE_MODELS, and the test beside this file fails the suite
 * the moment a selectable model has no row, so a new model cannot price at
 * zero unnoticed.
 *
 * Visibility, not billing: nothing invoices from these numbers.
 */

export interface ModelPrice {
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM: number;
  cacheWritePerM: number;
}

/** The date the prices below were read from the provider's list. */
export const PRICES_AS_OF = "2026-09-11";

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-sonnet-5": { inputPerM: 2.0, outputPerM: 10.0, cacheReadPerM: 0.2, cacheWritePerM: 2.5 },
  // Not selectable today; priced because the test environment and a future
  // selector may run it, and an unpriced run reads as unknown, not free.
  "claude-haiku-4-5": { inputPerM: 1.0, outputPerM: 5.0, cacheReadPerM: 0.1, cacheWritePerM: 1.25 },
};

/** The models the agent can run. One today: the environment default. */
export const SELECTABLE_MODELS = ["claude-sonnet-5"] as const;

export interface PricedBuckets {
  /** Uncached input tokens. */
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

/** The cost of a run's buckets in USD, to a millionth, or null when the
 * model has no row: an unpriced run must not read as free. Reasoning is
 * part of the output the provider bills, so it is not priced twice. */
export function costUsd(model: string, usage: PricedBuckets): number | null {
  const price = MODEL_PRICES[model];
  if (!price) return null;
  const micro =
    usage.input * price.inputPerM +
    usage.cacheRead * price.cacheReadPerM +
    usage.cacheWrite * price.cacheWritePerM +
    usage.output * price.outputPerM;
  return Math.round(micro) / 1_000_000;
}
