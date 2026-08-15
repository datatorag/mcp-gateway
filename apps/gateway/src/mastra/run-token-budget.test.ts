import { afterEach, describe, expect, it } from "vitest";
import { RUN_TOKEN_CEILING } from "@/gateway/billing/plans";
import {
  isRunTokenCeilingError,
  resetRunTokenBudgets,
  RunTokenCeilingError,
  runTokensUsed,
  usageTotal,
  withRunTokenCeiling,
} from "./run-token-budget";

/**
 * The mid-flight decision, proven on a fake model: the call that crosses the
 * ceiling FINISHES, and the NEXT call is refused with the typed error. A
 * ceiling that cuts an in-flight call, or one that lets a run keep going
 * forever, are the two failure modes these tests are shaped to catch.
 */

afterEach(() => resetRunTokenBudgets());

/** Minimal doGenerate-capable model speaking RAW spec-v2 usage (flat
 * numbers) — `wrapLanguageModel` normalises that into the nested buckets the
 * middleware reads, which was verified by probe, not assumed: feeding nested
 * usage into the raw slot double-wraps it into `{total: {total: …}}` and the
 * sum silently becomes string concatenation. */
function fakeModel(perCall: { input?: number; cachedInput?: number; output?: number }) {
  let calls = 0;
  const model = {
    specificationVersion: "v2",
    provider: "test",
    modelId: "fake-model",
    supportedUrls: {},
    doGenerate: async () => {
      calls++;
      return {
        content: [],
        finishReason: "stop",
        usage: {
          inputTokens: perCall.input ?? 0,
          cachedInputTokens: perCall.cachedInput ?? 0,
          outputTokens: perCall.output ?? 0,
          totalTokens: (perCall.input ?? 0) + (perCall.output ?? 0),
        },
        warnings: [],
      };
    },
    doStream: async () => {
      throw new Error("not exercised");
    },
  };
  return { model, callCount: () => calls };
}

describe("usageTotal", () => {
  it("counts all four buckets the way the distribution was measured", () => {
    // input + cache-read + cache-write + output; the provider reports cache
    // tokens exclusively of input, so this sum is not double counting.
    expect(
      usageTotal({
        inputTokens: { total: 100, cacheRead: 50, cacheWrite: 25 },
        outputTokens: { total: 10 },
      })
    ).toBe(185);
    expect(usageTotal(undefined)).toBe(0);
  });
});

describe("withRunTokenCeiling", () => {
  it("accumulates a wrapped call's tokens against its run", async () => {
    const { model } = fakeModel({ input: 100, cachedInput: 50, output: 10 });
    const wrapped = withRunTokenCeiling(model, "run-buckets") as typeof model;
    await wrapped.doGenerate();
    expect(runTokensUsed("run-buckets")).toBe(160);
  });

  it("finishes the crossing call and refuses the NEXT one, never the one in flight", async () => {
    const perCall = Math.ceil(RUN_TOKEN_CEILING / 2) + 1; // third call crosses
    const { model, callCount } = fakeModel({ input: perCall });
    const wrapped = withRunTokenCeiling(model, "run-crossing") as typeof model;

    await wrapped.doGenerate(); // under
    await wrapped.doGenerate(); // crosses the ceiling, must STILL complete
    expect(callCount()).toBe(2);
    expect(runTokensUsed("run-crossing")).toBeGreaterThanOrEqual(RUN_TOKEN_CEILING);

    // The next call is the one that gets refused, before the provider runs.
    await expect(wrapped.doGenerate()).rejects.toSatisfy(isRunTokenCeilingError);
    expect(callCount()).toBe(2);
  });

  it("budgets are per run: another run is untouched by a spent one", async () => {
    const { model } = fakeModel({ input: RUN_TOKEN_CEILING });
    const spent = withRunTokenCeiling(model, "run-a") as typeof model;
    await spent.doGenerate();
    await expect(spent.doGenerate()).rejects.toSatisfy(isRunTokenCeilingError);

    const fresh = withRunTokenCeiling(model, "run-b") as typeof model;
    await expect(fresh.doGenerate()).resolves.toBeDefined();
  });

  it("no run id means no budget and no wrapper — identity, never a throw", async () => {
    const { model } = fakeModel({ input: RUN_TOKEN_CEILING * 2 });
    const wrapped = withRunTokenCeiling(model, undefined);
    expect(wrapped).toBe(model);
  });

  it("the refusal is recognisable across module instances by name", () => {
    const err = new RunTokenCeilingError(151_000);
    expect(isRunTokenCeilingError(err)).toBe(true);
    // A structurally identical error from another bundle instance.
    const foreign = new Error("run token ceiling reached");
    foreign.name = "RunTokenCeilingError";
    expect(isRunTokenCeilingError(foreign)).toBe(true);
    expect(isRunTokenCeilingError(new Error("provider exploded"))).toBe(false);
  });
});
