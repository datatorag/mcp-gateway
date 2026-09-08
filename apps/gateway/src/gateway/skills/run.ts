import type { Delivery, PauseReason, RunStatus } from "@datatorag-mcp/db";
import type { Skill } from "@/lib/skills";
import type { ClaimResult } from "../usage/period";
import { capStoredErrorMessage } from "../usage/write";
import { deriveThreadId, mintRunId } from "../playground/run-ownership";
import { runEmail } from "./notify";
import type { ScheduleRow, ScheduleStore } from "./store";

/**
 * One scheduled skill run, from claim to history row to the one email
 * (SCRUM-225). Nobody is there, so every branch ends in a row that says what
 * happened and, for the three bad outcomes, a schedule that stopped itself
 * with the reason, and one message saying so.
 *
 * Everything with a side effect is injected: the engine (a model turn), the
 * allowance claim, the user lookup, the mail, the events and the clock. The
 * outcome table is therefore pinned in `run.test.ts` without a model or a
 * database, and the wiring lives in `scheduler.ts`.
 */

export const MAX_CONSECUTIVE_FAILURES = 3;

/** Tools that mean the skill delivered to the user itself, so our
 * notification would be a second message on top of theirs. Matched on the
 * tool name after the server prefix. */
export const SELF_DELIVERY_TOOLS = new Set(["gmail_send", "gmail_reply", "gmail_forward", "gmail_send_draft"]);

export type EngineToolCall = {
  toolName: string;
  /** The tool's text result, when it had one. */
  resultText: string | null;
  isError: boolean;
};

export type EngineResult = { text: string; toolCalls: EngineToolCall[] };

/** A model turn under the user's id on the given thread. Throws on a failed
 * turn; a thrown error MAY carry the `toolCalls` made before it failed, so a
 * run that mailed the user and then broke is still known to have mailed. */
export type RunEngine = (args: {
  userId: string;
  skill: Skill;
  threadId: string;
  runId: string;
}) => Promise<EngineResult>;

export type RunDeps = {
  store: ScheduleStore;
  engine: RunEngine;
  claim: (userId: string) => Promise<ClaimResult>;
  user: (userId: string) => Promise<{ email: string; name: string | null } | null>;
  sendEmail: (email: {
    to: string;
    toName: string | null;
    subject: string;
    text: string;
    html: string;
  }) => Promise<boolean>;
  track: (event: string, userId: string, props: Record<string, unknown>) => void;
  /** The service a tool result says is not connected, or null. Owned by
   * the MCP server beside the sentences it writes. */
  connectionFailure: (text: string) => string | null;
  baseUrl: string;
  now: () => Date;
};

export type Classified = {
  status: "succeeded" | "reconnect";
  toolCalls: Record<string, number>;
  toolCallCount: number;
  selfDelivered: boolean;
  service: string | null;
};

function bareName(toolName: string): string {
  const i = toolName.indexOf("__");
  return i === -1 ? toolName : toolName.slice(i + 2);
}

export function countTools(calls: EngineToolCall[]): {
  toolCalls: Record<string, number>;
  toolCallCount: number;
  selfDelivered: boolean;
} {
  const toolCalls: Record<string, number> = {};
  let selfDelivered = false;
  for (const c of calls) {
    toolCalls[c.toolName] = (toolCalls[c.toolName] ?? 0) + 1;
    if (!c.isError && SELF_DELIVERY_TOOLS.has(bareName(c.toolName))) selfDelivered = true;
  }
  return { toolCalls, toolCallCount: calls.length, selfDelivered };
}

/** Reads a finished turn into an outcome. A "not connected" answer from any
 * tool makes the run a reconnect outcome whatever the model said after it. */
export function classifyRun(
  result: EngineResult,
  connectionFailure: (text: string) => string | null
): Classified {
  const counts = countTools(result.toolCalls);
  for (const c of result.toolCalls) {
    const service = c.resultText ? connectionFailure(c.resultText) : null;
    if (service) return { status: "reconnect", service, ...counts };
  }
  return { status: "succeeded", service: null, ...counts };
}

export type RunReport = {
  runRowId: string;
  runId: string;
  threadId: string;
  status: Exclude<RunStatus, "running">;
  delivered: Delivery;
};

const PAUSE_FOR: Partial<Record<Exclude<RunStatus, "running">, PauseReason>> = {
  refused: "allowance",
  reconnect: "reconnect",
};

export async function runSchedule(schedule: ScheduleRow, skill: Skill, deps: RunDeps): Promise<RunReport> {
  const { userId } = schedule;
  const runId = mintRunId(userId);
  const runRowId = await deps.store.startRun({
    scheduleId: schedule.id,
    userId,
    skillSlug: skill.slug,
    runId,
  });
  // One thread per run, owned by the user by derivation, so it lists in
  // their conversations exactly as a manual run does.
  const threadId = deriveThreadId(userId, `skill-run:${runRowId}`);
  const startedAt = deps.now();

  let status: Exclude<RunStatus, "running">;
  let counts = { toolCalls: {} as Record<string, number>, toolCallCount: 0, selfDelivered: false };
  let service: string | null = null;
  let error: string | null = null;
  let resultText = "";
  let turnStarted = false;

  const claim = await deps.claim(userId);
  if (!claim.ok) {
    status = "refused";
  } else {
    turnStarted = true;
    deps.track("skill_run_started", userId, {
      skill: skill.slug,
      trigger: "scheduled",
      surface: "scheduler",
      schedule_id: schedule.id,
    });
    try {
      const result = await deps.engine({ userId, skill, threadId, runId });
      const classified = classifyRun(result, deps.connectionFailure);
      status = classified.status;
      service = classified.service;
      counts = classified;
      resultText = result.text;
    } catch (err) {
      status = "failed";
      error = capStoredErrorMessage(err instanceof Error ? err.message : String(err));
      const partial = (err as { toolCalls?: EngineToolCall[] })?.toolCalls;
      if (Array.isArray(partial)) counts = countTools(partial);
    }
  }

  // Delivery: the skill's own email is the delivery only for a run that
  // finished. A run that mailed and then failed still owes the user one
  // message saying it failed, and only one.
  let delivered: Delivery;
  if (status === "succeeded" && counts.selfDelivered) {
    delivered = "skill_email";
  } else {
    delivered = (await notify(deps, userId, skill, {
      status,
      threadId,
      service,
      error,
      resultText,
    }))
      ? "notification_email"
      : "thread_only";
  }

  await deps.store.finishRun(runRowId, {
    status,
    threadId: turnStarted ? threadId : null,
    toolCalls: counts.toolCalls,
    toolCallCount: counts.toolCallCount,
    delivered,
    error,
    finishedAt: deps.now(),
  });

  // Schedule state: a bad outcome stops the schedule with its reason; a
  // failure counts toward the auto-pause; a success clears the count.
  const failures = status === "failed" ? schedule.consecutiveFailures + 1 : 0;
  const pauseReason: PauseReason | null =
    PAUSE_FOR[status] ?? (failures >= MAX_CONSECUTIVE_FAILURES ? "failures" : null);
  await deps.store.patchSchedule(schedule.id, {
    consecutiveFailures: failures,
    lastRunAt: startedAt,
    ...(pauseReason ? { paused: true, pausedReason: pauseReason } : {}),
  });
  if (pauseReason) {
    deps.track("skill_schedule_paused", userId, {
      skill: skill.slug,
      by: "system",
      reason: pauseReason,
      schedule_id: schedule.id,
    });
  }

  deps.track("skill_run_finished", userId, {
    skill: skill.slug,
    trigger: "scheduled",
    status,
    delivered,
    tool_calls: counts.toolCallCount,
    schedule_id: schedule.id,
  });

  return { runRowId, runId, threadId, status, delivered };
}

async function notify(
  deps: RunDeps,
  userId: string,
  skill: Skill,
  input: {
    status: Exclude<RunStatus, "running">;
    threadId: string;
    service: string | null;
    error: string | null;
    resultText: string;
  }
): Promise<boolean> {
  const user = await deps.user(userId);
  if (!user) return false;
  const email = runEmail({
    status: input.status,
    skillTitle: skill.title,
    threadUrl: `${deps.baseUrl}/dashboard/agent?thread=${encodeURIComponent(input.threadId)}`,
    connectionsUrl: `${deps.baseUrl}/dashboard/connections`,
    billingUrl: `${deps.baseUrl}/dashboard/billing`,
    skillsUrl: `${deps.baseUrl}/dashboard/skills`,
    service: input.service,
    error: input.error,
    resultText: input.resultText,
  });
  try {
    return await deps.sendEmail({ to: user.email, toName: user.name, ...email });
  } catch (err) {
    console.warn("[skills] run email failed", err);
    return false;
  }
}
