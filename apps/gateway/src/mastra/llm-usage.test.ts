import { beforeEach, describe, expect, it, vi } from "vitest";

const capture = vi.fn();
vi.mock("@/lib/posthog-server", () => ({
  getPosthog: () => ({ capture }),
}));

const { withLlmUsageTracking } = await import("./llm-usage");

/** A model that reports the token buckets the provider spec defines, so the
 * assertions below are about OUR mapping rather than about a stub's shape.
 *
 * `v4` is not cosmetic. Declaring an older spec makes the SDK insert a
 * compatibility shim that treats `usage` as flat numbers and re-wraps whatever
 * it is handed, which silently turned every token count in these assertions
 * into an object. The real Anthropic model reports v4, so the stub must too or
 * the test is exercising a code path production never takes. */
function stubModel(usage: unknown) {
  return {
    specificationVersion: "v4",
    provider: "anthropic",
    modelId: "claude-test",
    defaultObjectGenerationMode: "tool",
    doGenerate: async (_options?: unknown) => ({ content: [], finishReason: "stop", usage, warnings: [] }),
    doStream: async (_options?: unknown) => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-delta", id: "1", delta: "hi" });
          controller.enqueue({ type: "finish", finishReason: "stop", usage });
          controller.close();
        },
      }),
    }),
  };
}

const USAGE = {
  inputTokens: { total: 120, noCache: 20, cacheRead: 100, cacheWrite: 7 },
  outputTokens: { total: 45, text: 45, reasoning: 3 },
};

const CTX = { runId: "run-abc", userId: "user-1" };

async function drain(stream: ReadableStream) {
  const reader = stream.getReader();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
}

describe("llm usage instrumentation", () => {
  beforeEach(() => capture.mockClear());

  it("reports a non-streaming call against the run id", async () => {
    const model = withLlmUsageTracking(stubModel(USAGE), CTX) as ReturnType<typeof stubModel>;
    await model.doGenerate({} as never);

    expect(capture).toHaveBeenCalledTimes(1);
    const call = capture.mock.calls[0][0];
    expect(call.event).toBe("$ai_generation");
    expect(call.distinctId).toBe("user-1");
    expect(call.properties).toMatchObject({
      // THE POINT OF THE WHOLE FEATURE: calls carry the run, so they can be
      // summed back into one billable unit.
      $ai_trace_id: "run-abc",
      $ai_model: "claude-test",
      $ai_provider: "anthropic",
      $ai_input_tokens: 120,
      $ai_output_tokens: 45,
      $ai_stream: false,
    });
  });

  it("keeps cache tokens out of the input count", async () => {
    const model = withLlmUsageTracking(stubModel(USAGE), CTX) as ReturnType<typeof stubModel>;
    await model.doGenerate({} as never);
    const props = capture.mock.calls[0][0].properties;

    // This provider counts cache tokens EXCLUSIVELY, and the agent caches its
    // system prompt and tool schemas on purpose. Folding these into
    // `$ai_input_tokens` would misprice nearly every step of every turn.
    expect(props.$ai_input_tokens).toBe(120);
    expect(props.$ai_cache_read_input_tokens).toBe(100);
    expect(props.$ai_cache_creation_input_tokens).toBe(7);
  });

  it("reports a streamed call once the stream drains", async () => {
    const model = withLlmUsageTracking(stubModel(USAGE), CTX) as ReturnType<typeof stubModel>;
    const { stream } = await model.doStream({} as never);

    // Usage rides the terminal part, so nothing can be known before the drain.
    expect(capture).not.toHaveBeenCalled();
    await drain(stream);

    expect(capture).toHaveBeenCalledTimes(1);
    const props = capture.mock.calls[0][0].properties;
    expect(props).toMatchObject({
      $ai_trace_id: "run-abc",
      $ai_input_tokens: 120,
      $ai_output_tokens: 45,
      $ai_stream: true,
    });
    expect(props.$ai_time_to_first_token).toBeTypeOf("number");
  });

  it("emits nothing when the call cannot be attributed to a run", async () => {
    // An event with no run id inflates the event count without changing the
    // distribution, which is worse than silence: it reads as coverage.
    const model = withLlmUsageTracking(stubModel(USAGE), {
      runId: undefined,
      userId: "user-1",
    }) as ReturnType<typeof stubModel>;
    await model.doGenerate({} as never);
    expect(capture).not.toHaveBeenCalled();
  });

  it("still reports when the model call throws", async () => {
    const failing = {
      ...stubModel(USAGE),
      doGenerate: async (_options?: unknown) => {
        throw new Error("upstream exploded");
      },
    };
    const model = withLlmUsageTracking(failing, CTX) as typeof failing;

    await expect(model.doGenerate({} as never)).rejects.toThrow("upstream exploded");
    // A failed call still consumed input tokens upstream, and a run that dies
    // half way is exactly the runaway the ceiling exists to bound.
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][0].properties.$ai_is_error).toBe(true);
  });
});
