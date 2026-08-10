import { wrapLanguageModel } from "ai";
import type { RequestContext } from "@mastra/core/request-context";

import { getPosthog } from "@/lib/posthog-server";

/**
 * Token usage per model call, emitted as PostHog `$ai_generation`.
 *
 * WHAT THIS IS FOR, because it shapes every decision below: pricing meters an
 * agent by the RUN, not the token, so the open question is the shape of the
 * per-run token distribution. A run makes many model calls and is one billable
 * unit, so the events have to be summable back into runs. Nine generations
 * with no shared identifier are data that looks complete and cannot answer the
 * question it was gathered for.
 *
 * So `$ai_trace_id` is the run id the playground ALREADY mints per run, and
 * not a new identifier. Two consequences worth having on purpose: the id is
 * the same one the approval gate verifies, so a run that suspends for approval
 * and resumes still reports as ONE trace rather than two; and there is no
 * second notion of "a run" that can drift out of step with the first.
 *
 * THIS IS NOT A BILLING LEDGER AND MUST NOT BECOME ONE. Analytics ingestion
 * lags and drops, which is fine for reading a percentile off a distribution
 * and disqualifying for an invoice. If usage-based billing ships, the ledger
 * belongs in Postgres where a row id can be an idempotency key.
 *
 * WHY A MODEL MIDDLEWARE rather than the framework's own observability
 * exporter, which does exist and would have been less code:
 *
 *   1. The exporter sets its own trace id. Ours has to be the run id, for the
 *      roll-up reason above, and that is the whole point of the ticket.
 *   2. The exporter captures `$ai_input` and `$ai_output_choices`, which here
 *      means the user's actual mail, documents and tickets, since that is what
 *      the tools return into the prompt. Shipping customer Workspace content
 *      to an analytics vendor is a data-flow change nobody asked for, and this
 *      product is verified against a Google security assessment. Token COUNTS
 *      answer the pricing question; the contents are not needed for it.
 *
 * So no message content is captured here. Only counts, model, and timing.
 *
 * HOW TO READ IT BACK. The events are per call; the question is per run, so the
 * consuming query groups by trace id first and only then takes a percentile.
 * Taking a percentile of the raw events answers a different question and looks
 * just as plausible:
 *
 *   SELECT count() AS runs,
 *          quantile(0.90)(total_tokens) AS p90,
 *          quantile(0.95)(total_tokens) AS p95,
 *          max(total_tokens)            AS max_tokens
 *   FROM (
 *     SELECT properties.$ai_trace_id AS run_id,
 *            sum(toInt(properties.$ai_input_tokens)
 *              + toInt(properties.$ai_cache_read_input_tokens)
 *              + toInt(properties.$ai_cache_creation_input_tokens)
 *              + toInt(properties.$ai_output_tokens)) AS total_tokens
 *     FROM events
 *     WHERE event = '$ai_generation' AND timestamp > now() - INTERVAL 30 DAY
 *     GROUP BY run_id
 *   )
 */

/** Where the run id is stashed for the model factory to read. Set by the chat
 * route, which is the only place that knows it. */
export const RUN_ID_CONTEXT_KEY = "llmUsageRunId";

/** PostHog derives `$ai_total_cost_usd` itself from provider, model and token
 * counts, so no price is hard-coded here. That is deliberate: a rate table in
 * this file would be a number that goes stale silently the next time a
 * provider reprices, and we have shipped several of those.
 *
 * The name is hard-coded rather than read off the model, which reports itself
 * as `anthropic.messages`. That pricing lookup matches on the provider NAME,
 * and a qualified variant is not what it indexes, so taking the model's own
 * string would cost nothing at ingest and quietly yield no cost at all. */
const PROVIDER = "anthropic";

type UsageBuckets = {
  inputTokens?: { total?: number; cacheRead?: number; cacheWrite?: number };
  outputTokens?: { total?: number; reasoning?: number };
};

function capture(opts: {
  distinctId: string;
  runId: string;
  modelId: string;
  usage: UsageBuckets | undefined;
  latencySeconds: number;
  streamed: boolean;
  timeToFirstTokenSeconds?: number;
  error?: string;
}): void {
  const posthog = getPosthog();
  if (!posthog) return;
  const input = opts.usage?.inputTokens;
  const output = opts.usage?.outputTokens;
  try {
    posthog.capture({
      distinctId: opts.distinctId,
      event: "$ai_generation",
      properties: {
        // The run, not the call. Everything else here is per call.
        $ai_trace_id: opts.runId,
        $ai_provider: PROVIDER,
        $ai_model: opts.modelId,
        $ai_input_tokens: input?.total ?? 0,
        $ai_output_tokens: output?.total ?? 0,
        // Reported separately because this provider counts cache tokens
        // EXCLUSIVELY of input tokens, and the agent deliberately caches its
        // system prompt and tool schemas. Folding them into the input count
        // would misprice every cached step, which is most steps.
        $ai_cache_read_input_tokens: input?.cacheRead ?? 0,
        $ai_cache_creation_input_tokens: input?.cacheWrite ?? 0,
        $ai_reasoning_tokens: output?.reasoning ?? 0,
        $ai_latency: opts.latencySeconds,
        $ai_stream: opts.streamed,
        ...(opts.timeToFirstTokenSeconds === undefined
          ? {}
          : { $ai_time_to_first_token: opts.timeToFirstTokenSeconds }),
        ...(opts.error === undefined ? {} : { $ai_is_error: true, $ai_error: opts.error }),
      },
    });
  } catch (err) {
    // Instrumentation must never be the reason a turn fails. Same convention
    // as every other capture in this codebase: warn and carry on.
    console.warn("[llm-usage] capture failed", err);
  }
}

const seconds = (startMs: number) => (Date.now() - startMs) / 1000;

/**
 * Wraps a model so every call it makes reports its token usage.
 *
 * Returns the model UNCHANGED when there is no run id to attribute the call
 * to. An untraceable generation cannot be summed into a run, so emitting it
 * would inflate the event count while leaving the distribution unchanged,
 * which is worse than not emitting it: it looks like coverage.
 */
export function withLlmUsageTracking<TModel>(
  model: TModel,
  ctx: { runId: string | undefined; userId: string | undefined }
): TModel {
  const { runId, userId } = ctx;
  if (!runId || !userId) return model;

  // GENERIC, AND CAST BACK TO THE MODEL'S OWN TYPE, because two packages here
  // are pinned to different revisions of the provider spec: the agent runtime
  // types a model against an older revision than the AI SDK's wrapper returns.
  // They are the same object shape at runtime (`doGenerate`/`doStream`), and a
  // wrapped model is by definition the same kind of thing as the model it
  // wraps, so preserving the caller's type is more honest than widening the
  // agent's config to accept both revisions.
  const wrapped = wrapLanguageModel({
    model: model as Parameters<typeof wrapLanguageModel>[0]["model"],
    middleware: {
      wrapGenerate: async ({ doGenerate, model: inner }) => {
        const startedAt = Date.now();
        try {
          const result = await doGenerate();
          capture({
            distinctId: userId,
            runId,
            modelId: inner.modelId,
            usage: result.usage as UsageBuckets | undefined,
            latencySeconds: seconds(startedAt),
            streamed: false,
          });
          return result;
        } catch (err) {
          capture({
            distinctId: userId,
            runId,
            modelId: inner.modelId,
            usage: undefined,
            latencySeconds: seconds(startedAt),
            streamed: false,
            error: err instanceof Error ? err.name : "unknown",
          });
          throw err;
        }
      },

      wrapStream: async ({ doStream, model: inner }) => {
        const startedAt = Date.now();
        const result = await doStream();
        let firstTokenAt: number | undefined;
        let usage: UsageBuckets | undefined;
        let reported = false;

        // Usage arrives on the terminal `finish` part, so it is only knowable
        // once the stream drains. Reporting from `flush` rather than from the
        // finish part itself is what makes an ABANDONED stream still report:
        // a turn the client disconnects from has really consumed tokens, and
        // dropping it would bias the distribution toward cheap runs.
        const tap = new TransformStream({
          transform(chunk, controller) {
            const part = chunk as { type?: string; usage?: UsageBuckets };
            if (firstTokenAt === undefined && part.type === "text-delta") {
              firstTokenAt = Date.now();
            }
            if (part.type === "finish" && part.usage) usage = part.usage;
            controller.enqueue(chunk);
          },
          flush() {
            if (reported) return;
            reported = true;
            capture({
              distinctId: userId,
              runId,
              modelId: inner.modelId,
              usage,
              latencySeconds: seconds(startedAt),
              streamed: true,
              timeToFirstTokenSeconds:
                firstTokenAt === undefined ? undefined : (firstTokenAt - startedAt) / 1000,
            });
          },
        });

        return { ...result, stream: result.stream.pipeThrough(tap) };
      },
    },
  });
  return wrapped as TModel;
}

/** Reads the ids the wrapper needs off the per-request context. */
export function usageContextFrom(
  requestContext: RequestContext,
  userIdKey: string
): { runId: string | undefined; userId: string | undefined } {
  const read = (key: string): string | undefined => {
    const value = requestContext.get(key);
    return typeof value === "string" && value.length > 0 ? value : undefined;
  };
  return { runId: read(RUN_ID_CONTEXT_KEY), userId: read(userIdKey) };
}
