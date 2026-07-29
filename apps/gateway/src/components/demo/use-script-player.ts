"use client";

/** Timer-driven playback of a DemoScript into the UIMessage[] shape the
 * playground presentation layer renders.
 *
 * ENTIRELY CLIENT-SIDE. Playback makes no network requests of any kind: no
 * MCP calls, no API routes, no LLM. "Approve" and "Deny" are pure state
 * transitions over authored data — there is nothing server-side to resolve.
 *
 * The pure core (`initialState`, `advance`, `decide`, `finishedState`,
 * `buildMessages`) is exported for tests; the hook only owns timers.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AnyToolPart,
  PlaygroundMessage,
} from "@/app/dashboard/playground-presentation";
import type {
  DemoApprovalBeat,
  DemoScript,
  DemoStep,
  DemoToolBeat,
} from "./demo-scripts";

/* ----------------------------- pure core ---------------------------------- */

export interface PlayerState {
  /** Index of the step currently playing. Steps before it are complete. */
  cursor: number;
  /** Revealed words of the current assistant step (word-streaming). */
  words: number;
  /** Current tool/approval beat: still visibly running? */
  running: boolean;
  /** Decision state of the approval beat at the cursor. */
  approval: "pending" | "approved" | "denied" | null;
  phase: "playing" | "awaiting-approval" | "done";
}

export const DEFAULTS = {
  userDwellMs: 700,
  assistantDwellMs: 600,
  wordEveryMs: 45,
  toolRunMs: 1100,
  toolSettleMs: 900,
  /** Dwell after an approval resolves, before the next beat — the resolved
   * card should be readable, not a flash frame. */
  approvedSettleMs: 1400,
} as const;

export function initialState(): PlayerState {
  return { cursor: 0, words: 0, running: true, approval: null, phase: "playing" };
}

export function finishedState(script: DemoScript): PlayerState {
  return {
    cursor: script.steps.length,
    words: 0,
    running: false,
    approval: hasApproval(script) ? "approved" : null,
    phase: "done",
  };
}

function hasApproval(script: DemoScript): boolean {
  return script.steps.some((s) => s.kind === "approval");
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** The next state plus how long to wait before applying it. The hook is a
 * dumb clock around this. Returns null when nothing is pending (terminal, or
 * waiting on the viewer/auto-approve timer handled separately). */
export function advance(
  script: DemoScript,
  state: PlayerState
): { next: PlayerState; delayMs: number } | null {
  if (state.phase === "done") return null;
  const step = script.steps[state.cursor];
  if (!step) return null;

  const toNextStep: PlayerState = {
    cursor: state.cursor + 1,
    words: 0,
    running: true,
    approval: null,
    phase: state.cursor + 1 >= script.steps.length ? "done" : "playing",
  };

  switch (step.kind) {
    case "user":
      return { next: toNextStep, delayMs: DEFAULTS.userDwellMs };
    case "assistant": {
      const total = wordCount(step.text);
      if (state.words < total) {
        return {
          next: { ...state, words: state.words + 1 },
          delayMs: DEFAULTS.wordEveryMs,
        };
      }
      return { next: toNextStep, delayMs: DEFAULTS.assistantDwellMs };
    }
    case "tool": {
      if (state.running) {
        return {
          next: { ...state, running: false },
          delayMs: step.runMs ?? DEFAULTS.toolRunMs,
        };
      }
      return { next: toNextStep, delayMs: DEFAULTS.toolSettleMs };
    }
    case "approval": {
      if (state.approval === null) {
        // Card appears after a short "running" moment, then playback holds.
        if (state.running) {
          return {
            next: { ...state, running: false, approval: "pending" },
            delayMs: step.runMs ?? DEFAULTS.toolRunMs,
          };
        }
        return null;
      }
      if (state.approval === "pending") {
        // Hold here — resolution comes from decide() (viewer click or the
        // auto-approve timer), not from the clock.
        if (state.phase === "awaiting-approval") return null;
        return {
          next: { ...state, phase: "awaiting-approval" },
          delayMs: 0,
        };
      }
      if (state.approval === "approved") {
        return { next: toNextStep, delayMs: DEFAULTS.approvedSettleMs };
      }
      // Denied: the arc ends here; the denied text renders from this state.
      return {
        next: { ...state, phase: "done" },
        delayMs: 0,
      };
    }
  }
}

/** Viewer (or the auto-approve timer) decided the pending approval. */
export function decide(state: PlayerState, approved: boolean): PlayerState {
  if (state.approval !== "pending") return state;
  return { ...state, approval: approved ? "approved" : "denied", phase: "playing" };
}

/* ------------------------- state → UIMessage[] ----------------------------- */

function toolPart(
  beat: DemoToolBeat | DemoApprovalBeat,
  index: number,
  stage: "running" | "output" | "approval-pending" | "denied"
): AnyToolPart {
  const base = {
    type: `tool-${beat.toolName}` as const,
    toolCallId: `demo-call-${index}`,
  };
  switch (stage) {
    case "running":
      return { ...base, state: "input-available", input: beat.input };
    case "approval-pending":
      return {
        ...base,
        state: "approval-requested",
        input: beat.input,
        approval: { id: `demo-approval-${index}` },
      };
    case "denied":
      return {
        ...base,
        state: "output-denied",
        input: beat.input,
        approval: { id: `demo-approval-${index}`, approved: false },
      };
    case "output":
      return {
        ...base,
        state: "output-available",
        input: beat.input,
        output: beat.output,
      };
  }
}

function firstWords(text: string, words: number): string {
  const all = text.split(/\s+/).filter(Boolean);
  return all.slice(0, words).join(" ");
}

/** Project the player state onto the message shape the presentation layer
 * accepts. Consecutive non-user steps form one assistant message, exactly as
 * a live turn assembles its parts. */
export function buildMessages(
  script: DemoScript,
  state: PlayerState
): PlaygroundMessage[] {
  const messages: PlaygroundMessage[] = [];
  let assistant: PlaygroundMessage | null = null;

  const pushAssistantPart = (part: PlaygroundMessage["parts"][number]) => {
    if (!assistant) {
      assistant = { id: `demo-a-${messages.length}`, role: "assistant", parts: [] };
      messages.push(assistant);
    }
    assistant.parts.push(part);
  };

  for (let i = 0; i < script.steps.length; i++) {
    const step = script.steps[i];
    const isCurrent = i === state.cursor;
    if (i > state.cursor) break;

    if (step.kind === "user") {
      assistant = null;
      messages.push({
        id: `demo-u-${i}`,
        role: "user",
        parts: [{ type: "text", text: step.text }],
      });
      continue;
    }

    if (step.kind === "assistant") {
      const text = isCurrent ? firstWords(step.text, state.words) : step.text;
      if (text.length > 0) pushAssistantPart({ type: "text", text });
      continue;
    }

    if (step.kind === "tool") {
      pushAssistantPart(
        toolPart(step, i, isCurrent && state.running ? "running" : "output")
      );
      continue;
    }

    // approval beat
    if (!isCurrent || state.approval === "approved") {
      pushAssistantPart(toolPart(step, i, "output"));
    } else if (state.approval === "denied") {
      pushAssistantPart(toolPart(step, i, "denied"));
      pushAssistantPart({ type: "text", text: script.deniedText });
    } else if (state.approval === "pending") {
      pushAssistantPart(toolPart(step, i, "approval-pending"));
    } else {
      pushAssistantPart(toolPart(step, i, "running"));
    }
  }

  return messages;
}

/* --------------------------------- hook ------------------------------------ */

export interface ScriptPlayer {
  messages: PlaygroundMessage[];
  phase: PlayerState["phase"];
  /** True while the ConfirmCard is on screen waiting. */
  awaitingApproval: boolean;
  onDecide: (approvalId: string, approved: boolean) => void;
}

/** Plays `script` from mount. Remount (new `key`) to replay or switch
 * scripts. `active` gates start so the section can wait for visibility. */
export function useScriptPlayer(
  script: DemoScript,
  active: boolean
): ScriptPlayer {
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const [state, setState] = useState<PlayerState>(() =>
    // Reduced motion: the completed end state, never a frozen half-scene.
    reducedMotion ? finishedState(script) : initialState()
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  // Clock: apply `advance` transitions on their own schedule.
  useEffect(() => {
    if (!active || state.phase === "done") return;
    const pending = advance(script, state);
    if (!pending) return;
    const t = setTimeout(() => setState(pending.next), pending.delayMs);
    return () => clearTimeout(t);
  }, [script, state, active]);

  // Auto-approve: a passive viewer still sees the whole arc.
  useEffect(() => {
    if (!active || state.phase !== "awaiting-approval") return;
    const step = script.steps[state.cursor];
    const dwell =
      step?.kind === "approval" ? step.approvalDwellMs : 4000;
    const t = setTimeout(
      () => setState((s) => decide(s, true)),
      dwell
    );
    return () => clearTimeout(t);
  }, [script, state, active]);

  const messages = useMemo(
    () => buildMessages(script, state),
    [script, state]
  );

  return {
    messages,
    phase: state.phase,
    awaitingApproval: state.phase === "awaiting-approval",
    onDecide: (_approvalId, approved) => setState((s) => decide(s, approved)),
  };
}
