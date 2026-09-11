import type { Processor } from "@mastra/core/processors";
import type { RequestContext } from "@mastra/core/request-context";

import { RUN_SOFT_CEILING } from "@/gateway/billing/plans";
import { RUN_ID_CONTEXT_KEY } from "./llm-usage";
import { SKILL_RUN_CONTEXT_KEY } from "./mcp/client";
import { runTokensUsed } from "./run-token-budget";

/**
 * The soft ceiling (SCRUM-251): a run that has used most of its budget is
 * told to close.
 *
 * The hard ceiling refuses the NEXT model call once a run is over it, so a
 * run always ends one step past the line, and if that step was a read the
 * run ends with no report. This processor runs before each model call and,
 * on a skill-seeded turn whose run has reached RUN_SOFT_CEILING, appends one
 * closing instruction to the step's messages. It reads the same accumulator
 * the hard ceiling reads, so the two never disagree about where a run
 * stands; the chat route reports the crossing as a `soft` ceiling event
 * from the same reading.
 *
 * Skill runs only: the instruction is written for a run with a report to
 * send. An ordinary chat turn is bounded by its step cap long before its
 * budget and gets nothing here.
 *
 * Appended once per step. The runtime hands the processor the step's
 * message list; if a previous step's copy is still in it, no second copy is
 * added, so the model never sees the instruction twice in one prompt.
 */

export const CLOSING_INSTRUCTION =
  "This run has used most of its budget. Write your report now from what you already have. " +
  "Send it with the one send this skill allows, and make no other tool calls: no further " +
  "reads, no more labels or tasks. If something is unfinished, say so in the report.";

const CLOSING_ID_PREFIX = "soft-ceiling-closing-";

type Message = { id?: unknown; role?: unknown; content?: { parts?: Array<{ type?: unknown; text?: unknown }> } };

/** True for a message this processor appended, whichever step appended it. */
export function isClosingInstruction(message: Message): boolean {
  return typeof message.id === "string" && message.id.startsWith(CLOSING_ID_PREFIX);
}

function closingMessage(runId: string, stepNumber: number) {
  return {
    id: `${CLOSING_ID_PREFIX}${runId}-${stepNumber}`,
    role: "user" as const,
    createdAt: new Date(),
    content: { format: 2 as const, parts: [{ type: "text" as const, text: CLOSING_INSTRUCTION }] },
  };
}

function read(context: RequestContext | undefined, key: string): string | undefined {
  const value = context?.get(key);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

// `satisfies`, not a type annotation, for the same reason as the breakpoint
// processor: the agent's processor slot requires the step hook on the type.
export const softCeilingClosing = {
  id: "soft-ceiling-closing",
  processInputStep({
    messages,
    requestContext,
    stepNumber,
  }: {
    messages: unknown[];
    requestContext?: RequestContext;
    stepNumber?: number;
  }) {
    const runId = read(requestContext, RUN_ID_CONTEXT_KEY);
    const skill = read(requestContext, SKILL_RUN_CONTEXT_KEY);
    if (!runId || !skill) return { messages: messages as never };
    if (runTokensUsed(runId) < RUN_SOFT_CEILING) return { messages: messages as never };
    if ((messages as Message[]).some(isClosingInstruction)) return { messages: messages as never };
    return { messages: [...messages, closingMessage(runId, stepNumber ?? 0)] as never };
  },
} satisfies Processor;
