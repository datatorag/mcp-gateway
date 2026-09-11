import { afterEach, describe, expect, it, vi } from "vitest";

import { buildPluginRequestContext } from "./mcp/client";
import { RUN_ID_CONTEXT_KEY } from "./llm-usage";
import { requestStop, resetRunRegistry } from "@/gateway/playground/run-registry";
import { STOP_REASON, userStop } from "./user-stop";

/**
 * SCRUM-258: the user's Stop ends a run at the next step boundary. The
 * processor runs before each model call, after the previous step's tool
 * calls have finished; when the run's stop was requested it aborts the
 * step, so no further model call starts.
 */

afterEach(() => resetRunRegistry());

const msg = (text: string) => ({ role: "user", content: { format: 2, parts: [{ type: "text", text }] } });

function context(runId: string | null) {
  const ctx = buildPluginRequestContext({ userId: "user-1" });
  if (runId) ctx.set(RUN_ID_CONTEXT_KEY, runId);
  return ctx;
}

function step(runId: string | null) {
  const abort = vi.fn((reason?: string) => {
    throw new Error(`aborted: ${reason}`);
  });
  const messages = [msg("run it")];
  const run = () =>
    userStop.processInputStep({
      messages: messages as never,
      requestContext: context(runId),
      abort: abort as never,
    } as never);
  return { abort, messages, run };
}

describe("the user's stop (SCRUM-258)", () => {
  it("aborts the next step, with the stop reason, once the run's stop was requested", () => {
    requestStop("run-stop");
    const { abort, run } = step("run-stop");
    expect(() => run()).toThrow(/aborted/);
    expect(abort).toHaveBeenCalledTimes(1);
    expect(abort.mock.calls[0]![0]).toBe(STOP_REASON);
  });

  it("does nothing for a run nobody asked to stop", () => {
    const { abort, messages, run } = step("run-go");
    const out = run() as { messages?: unknown[] } | undefined;
    expect(abort).not.toHaveBeenCalled();
    expect(out?.messages ?? messages).toBe(messages);
  });

  it("does nothing, and cannot throw, without a run id", () => {
    requestStop("run-other");
    const { abort, run } = step(null);
    expect(() => run()).not.toThrow();
    expect(abort).not.toHaveBeenCalled();
  });

  it("the reason names the user's stop and carries no dash", () => {
    expect(STOP_REASON).toMatch(/stop/i);
    expect(STOP_REASON).not.toContain("\u2014");
  });
});
