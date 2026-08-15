import { wrapLanguageModel } from "ai";

import { RUN_TOKEN_CEILING } from "@/gateway/billing/plans";

/**
 * The per-run token ceiling (SCRUM-84), enforced at the step boundary.
 *
 * WHAT HAPPENS WHEN A RUN HITS THE CEILING MID-FLIGHT, decided and written
 * down rather than left to whoever reads the stack trace: the model call that
 * crosses the ceiling FINISHES NORMALLY, and the ceiling refuses the NEXT
 * call before it starts. Nothing in flight is ever truncated. The refusal is
 * a typed error the chat route recognises and turns into a plain user-visible
 * message, so the run ends the way a cap-hit run begins: as a product state
 * the user can read, not a mystery failure.
 *
 * Why that option and not the others considered:
 * - Truncating the in-flight response mangles output mid-sentence and reads
 *   as a model bug, and the tokens are already spent by the time the stream
 *   shows them, so cutting it saves nothing.
 * - Refusing the next TOOL call instead of the next MODEL call would let the
 *   model keep generating around the refusal, burning more of exactly the
 *   thing the ceiling bounds.
 * - Refusing the next model call spends nothing further, keeps every
 *   completed step's output intact, and matches the shape the codebase
 *   already trusts: `claimAgentRun` refuses the next run rather than killing
 *   one, `countToolCall` never un-rings a bell, and a hard stop is a product
 *   state, not an error.
 *
 * A COUNTER, NOT A LEDGER, same doctrine as the period counters: in-process,
 * approximate, and reset by a restart. A run that resumes after a deploy gets
 * a fresh budget — off in the user's favour, occasionally, on a boundary,
 * which is the accepted trade everywhere else in this file's family. Cost
 * protection with that property still bounds the month to allowance x
 * ceiling per subscriber within any process lifetime, which is what the
 * ceiling exists to do.
 *
 * Tokens are counted the way the distribution that set the ceiling was
 * measured: input + cache-read + cache-write + output per model call, summed
 * over the run. The provider reports cache tokens EXCLUSIVELY of input
 * tokens, so adding all four buckets is not double counting.
 */

/** Bounded accumulator: run id -> tokens consumed so far. Insertion-order
 * eviction keeps it from growing for the life of the process; a run old
 * enough to be evicted under this bound has been idle across a thousand
 * newer runs, and the cost of forgetting it is one run's fresh budget. */
const MAX_TRACKED_RUNS = 1024;
const runTokens = new Map<string, number>();

type UsageBuckets = {
  inputTokens?: { total?: number; cacheRead?: number; cacheWrite?: number };
  outputTokens?: { total?: number };
};

/** Exported for its own unit test; production callers are the wrappers
 * below. The buckets arrive already normalised by `wrapLanguageModel`
 * (raw v2 `inputTokens`/`cachedInputTokens`/`outputTokens` numbers become
 * this nested shape inside middleware). */
export function usageTotal(usage: UsageBuckets | undefined): number {
  const input = usage?.inputTokens;
  const output = usage?.outputTokens;
  return (
    (input?.total ?? 0) +
    (input?.cacheRead ?? 0) +
    (input?.cacheWrite ?? 0) +
    (output?.total ?? 0)
  );
}

function note(runId: string, tokens: number): void {
  if (tokens <= 0) return;
  if (!runTokens.has(runId) && runTokens.size >= MAX_TRACKED_RUNS) {
    const oldest = runTokens.keys().next().value;
    if (oldest !== undefined) runTokens.delete(oldest);
  }
  runTokens.set(runId, (runTokens.get(runId) ?? 0) + tokens);
}

/** Tokens the run has consumed so far, as this process has seen them. */
export function runTokensUsed(runId: string): number {
  return runTokens.get(runId) ?? 0;
}

/** Test seam: the accumulator is process state, and tests must not leak runs
 * into each other. Not for production use — production forgets via the
 * eviction bound and process restarts only. */
export function resetRunTokenBudgets(): void {
  runTokens.clear();
}

/** The refusal, typed so the chat route can tell it from a provider failure.
 * Matched by NAME as well as instanceof, because the route and the agent can
 * see different module instances across bundling seams. */
export class RunTokenCeilingError extends Error {
  readonly tokensUsed: number;
  constructor(tokensUsed: number) {
    super(`run token ceiling reached: ${tokensUsed} >= ${RUN_TOKEN_CEILING}`);
    this.name = "RunTokenCeilingError";
    this.tokensUsed = tokensUsed;
  }
}

export function isRunTokenCeilingError(err: unknown): boolean {
  return (
    err instanceof RunTokenCeilingError ||
    (err instanceof Error && err.name === "RunTokenCeilingError")
  );
}

/** What the user reads when the ceiling stops a run. Everything the run
 * already did is intact, and the next message starts a fresh run — say both,
 * because a stop with neither fact looks like data loss. */
export const RUN_CEILING_MESSAGE =
  "This run reached its size limit, so it stopped before starting another step. " +
  "Everything it already finished is saved. Send a new message to continue.";

/**
 * Wraps a model so a run that has consumed the ceiling is refused its next
 * call. Composed OUTSIDE the usage-tracking wrapper in the agent's model
 * factory, so a refused call never reaches the provider or the analytics tap.
 * Identity when there is no run id: an unattributable call cannot be budgeted
 * and the playground always supplies one.
 */
export function withRunTokenCeiling<TModel>(
  model: TModel,
  runId: string | undefined
): TModel {
  if (!runId) return model;

  const assertWithinCeiling = () => {
    const used = runTokensUsed(runId);
    if (used >= RUN_TOKEN_CEILING) throw new RunTokenCeilingError(used);
  };

  const wrapped = wrapLanguageModel({
    model: model as Parameters<typeof wrapLanguageModel>[0]["model"],
    middleware: {
      wrapGenerate: async ({ doGenerate }) => {
        assertWithinCeiling();
        const result = await doGenerate();
        note(runId, usageTotal(result.usage as UsageBuckets | undefined));
        return result;
      },
      wrapStream: async ({ doStream }) => {
        assertWithinCeiling();
        const result = await doStream();
        let noted = false;
        // Usage arrives on the terminal `finish` part; noting from `flush`
        // as well means an abandoned stream still counts — those tokens were
        // really consumed, and a budget that forgets them under-counts the
        // exact runs it exists to bound.
        let pending: UsageBuckets | undefined;
        const tap = new TransformStream({
          transform(chunk, controller) {
            const part = chunk as { type?: string; usage?: UsageBuckets };
            if (part.type === "finish" && part.usage) pending = part.usage;
            controller.enqueue(chunk);
          },
          flush() {
            if (noted) return;
            noted = true;
            note(runId, usageTotal(pending));
          },
        });
        return { ...result, stream: result.stream.pipeThrough(tap) };
      },
    },
  });
  return wrapped as TModel;
}
