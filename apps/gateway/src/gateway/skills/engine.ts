import type { Database } from "@datatorag-mcp/db";
import { getMastra, DATATORAG_AGENT_ID } from "@/mastra";
import { RUN_ID_CONTEXT_KEY } from "@/mastra/llm-usage";
import { buildPluginRequestContext, SKILL_RUN_CONTEXT_KEY } from "@/mastra/mcp/client";
import { runAccountsFrom, skillRunMessage } from "@/lib/skills";
import { SKILL_RUN_MAX_STEPS } from "@/mastra/run-steps";
import { listConnectedAccounts } from "../connected-accounts";
import { setThreadTitleIfEmpty } from "../playground/threads";
import { trackAgentRun } from "../track";
import type { EngineToolCall, RunEngine } from "./run";

/**
 * The scheduler's model turn (SCRUM-225): the same agent, the same message
 * the dashboard submits, the same per-request context the chat route builds
 * (identity, the run id the usage events carry, and the skill-run key that
 * swaps the approval policy to "nothing prompts"), on a thread the user
 * owns. What differs from the chat route is only that nothing streams to a
 * browser, so this awaits the turn and hands back its text and tool calls.
 */

/** Reads one tool result, whatever shape the runtime hands it in, into the
 * name, the text and the error flag the classifier needs. Tolerant on
 * purpose: a shape this does not know becomes "a call with no text", never
 * a thrown error that would turn a finished run into a failed one. */
export function normalizeToolResult(raw: unknown): EngineToolCall | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const payload = (r.payload && typeof r.payload === "object" ? r.payload : r) as Record<string, unknown>;
  const toolName = typeof payload.toolName === "string" ? payload.toolName : null;
  if (!toolName) return null;
  const result = payload.result ?? payload.output ?? null;
  return { toolName, resultText: resultToText(result), isError: isErrorResult(result) };
}

function resultToText(result: unknown): string | null {
  if (result == null) return null;
  if (typeof result === "string") return result;
  if (typeof result !== "object") return String(result);
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.content)) {
    const texts = r.content
      .map((c) => (c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string" ? (c as { text: string }).text : ""))
      .filter(Boolean);
    if (texts.length) return texts.join("\n");
  }
  if (typeof r.text === "string") return r.text;
  try {
    return JSON.stringify(result);
  } catch {
    return null;
  }
}

function isErrorResult(result: unknown): boolean {
  return Boolean(result && typeof result === "object" && (result as { isError?: unknown }).isError === true);
}

export function mastraEngine(db: Database): RunEngine {
  return async ({ userId, skill, threadId, runId, timezone }) => {
    const requestContext = buildPluginRequestContext({ userId });
    requestContext.set(RUN_ID_CONTEXT_KEY, runId);
    requestContext.set(SKILL_RUN_CONTEXT_KEY, skill.slug);
    void trackAgentRun(db, userId, { runId, runsUsed: 0, skill: skill.slug, trigger: "scheduled" });

    const agent = getMastra().getAgent(DATATORAG_AGENT_ID);
    const partial: EngineToolCall[] = [];
    try {
      const accounts = runAccountsFrom(await listConnectedAccounts(db, userId));
      // The clock ends the message (SCRUM-242): the runner's time, the
      // schedule's zone, so "today" is the user's today and never a guess.
      const clock = { now: new Date(), zone: timezone ?? null };
      const result = await agent.generate(skillRunMessage(skill, accounts, clock), {
        memory: { thread: threadId, resource: userId },
        requestContext,
        runId,
        maxSteps: SKILL_RUN_MAX_STEPS,
        onStepFinish: (step: unknown) => {
          const s = step as { toolResults?: unknown[] };
          for (const raw of s.toolResults ?? []) {
            const call = normalizeToolResult(raw);
            if (call) partial.push(call);
          }
        },
      } as never);
      // A scheduled thread gets its title from the skill, not from the seeded
      // message's first line, which is the same for every run of every skill.
      void setThreadTitleIfEmpty(userId, threadId, skill.title).catch(() => undefined);
      const text = typeof (result as { text?: unknown }).text === "string" ? (result as { text: string }).text : "";
      const fromResult = ((result as { toolResults?: unknown[] }).toolResults ?? [])
        .map(normalizeToolResult)
        .filter((c): c is EngineToolCall => c !== null);
      return { text, toolCalls: fromResult.length ? fromResult : partial };
    } catch (err) {
      // The calls made before the failure ride on the error, so a run that
      // mailed the user and then broke is still known to have mailed.
      throw Object.assign(err instanceof Error ? err : new Error(String(err)), { toolCalls: partial });
    }
  };
}
