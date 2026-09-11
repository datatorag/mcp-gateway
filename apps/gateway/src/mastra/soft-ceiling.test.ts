import { afterEach, describe, expect, it } from "vitest";

import { RUN_SOFT_CEILING, RUN_SOFT_CEILING_RATIO, RUN_TOKEN_CEILING } from "@/gateway/billing/plans";
import { buildPluginRequestContext, SKILL_RUN_CONTEXT_KEY } from "./mcp/client";
import { RUN_ID_CONTEXT_KEY } from "./llm-usage";
import { resetRunTokenBudgets, withRunTokenCeiling } from "./run-token-budget";
import { CLOSING_INSTRUCTION, isClosingInstruction, softCeilingClosing } from "./soft-ceiling";

/**
 * SCRUM-251: a run that has used most of its budget is told to close, on
 * the step after it crossed the line, once per step, and only on a
 * skill-seeded turn. The line is read off the same accumulator the hard
 * ceiling reads, so the two cannot disagree about where a run stands.
 */

afterEach(() => resetRunTokenBudgets());

/** Spends `tokens` uncached input against a run through the real ceiling
 * wrapper, so the accumulator holds what a real step would leave. */
async function spend(runId: string, tokens: number): Promise<void> {
  const model = {
    specificationVersion: "v2",
    provider: "test",
    modelId: "fake-model",
    supportedUrls: {},
    doGenerate: async () => ({
      content: [],
      finishReason: "stop",
      usage: { inputTokens: tokens, cachedInputTokens: 0, outputTokens: 0, totalTokens: tokens },
      warnings: [],
    }),
    doStream: async () => {
      throw new Error("not exercised");
    },
  };
  const wrapped = withRunTokenCeiling(model, runId) as typeof model;
  await wrapped.doGenerate();
}

type Part = { type: string; text?: string };
type Message = { id?: string; role: string; content: { format: 2; parts: Part[] } };
const msg = (role: string, text: string): Message => ({ role, content: { format: 2, parts: [{ type: "text", text }] } });

function context(runId: string, skill: string | null) {
  const ctx = buildPluginRequestContext({ userId: "user-1" });
  ctx.set(RUN_ID_CONTEXT_KEY, runId);
  if (skill) ctx.set(SKILL_RUN_CONTEXT_KEY, skill);
  return ctx;
}

async function step(messages: Message[], runId: string, skill: string | null): Promise<Message[]> {
  const out = await softCeilingClosing.processInputStep({
    messages: messages as never,
    requestContext: context(runId, skill),
  } as never);
  return ((out as { messages?: unknown[] } | undefined)?.messages ?? messages) as Message[];
}

const tail = (messages: Message[]) => messages[messages.length - 1]!;

describe("the soft ceiling (SCRUM-251)", () => {
  it("sits at 85 percent of the ceiling, beside it", () => {
    expect(RUN_SOFT_CEILING_RATIO).toBe(0.85);
    expect(RUN_SOFT_CEILING).toBe(Math.round(RUN_TOKEN_CEILING * 0.85));
    expect(RUN_SOFT_CEILING).toBeLessThan(RUN_TOKEN_CEILING);
  });

  it("a skill run under the line gets nothing", async () => {
    await spend("run-under", RUN_SOFT_CEILING - 1);
    const out = await step([msg("user", "run it")], "run-under", "morning-brief");
    expect(out).toHaveLength(1);
  });

  it("a skill run at the line gets the closing instruction on its next step", async () => {
    await spend("run-at", RUN_SOFT_CEILING);
    const out = await step([msg("user", "run it"), msg("assistant", "reading")], "run-at", "morning-brief");
    expect(out).toHaveLength(3);
    expect(tail(out).role).toBe("user");
    expect(tail(out).content.parts[0]!.text).toBe(CLOSING_INSTRUCTION);
    expect(isClosingInstruction(tail(out))).toBe(true);
  });

  it("appends it once per step, never twice, even when the previous step's copy is still in the list", async () => {
    await spend("run-twice", RUN_SOFT_CEILING + 5_000);
    const first = await step([msg("user", "run it")], "run-twice", "morning-brief");
    const second = await step(first, "run-twice", "morning-brief");
    expect(second.filter(isClosingInstruction)).toHaveLength(1);
  });

  it("an ordinary chat turn over the line gets nothing: the instruction is written for a run with a report to send", async () => {
    await spend("run-chat", RUN_TOKEN_CEILING - 1);
    const out = await step([msg("user", "hi")], "run-chat", null);
    expect(out).toHaveLength(1);
  });

  it("a step with no run id gets nothing", async () => {
    const out = await softCeilingClosing.processInputStep({
      messages: [msg("user", "hi")] as never,
      requestContext: buildPluginRequestContext({ userId: "user-1" }),
    } as never);
    expect(((out as { messages?: unknown[] } | undefined)?.messages ?? []).length).toBe(1);
  });

  it("the instruction says what to do and carries no dash", () => {
    expect(CLOSING_INSTRUCTION).toMatch(/report/i);
    expect(CLOSING_INSTRUCTION).toMatch(/no (other|further|more) tool calls/i);
    expect(CLOSING_INSTRUCTION).not.toContain("\u2014");
    expect(CLOSING_INSTRUCTION).not.toContain("\u2013");
  });
});
