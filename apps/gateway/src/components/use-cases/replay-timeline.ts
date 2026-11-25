import type { UseCase, UseCaseResult } from "@/lib/use-cases";

/**
 * The chat replay of a use case as a list of frames (SCRUM-514), computed
 * once from the record. The component is a clock over this list: it shows
 * frame n, waits that frame's time, and shows the next. Pure, so the whole
 * replay is tested without a timer.
 *
 * The order is the order of a real turn: the prompt is typed, each step
 * appears running and then finishes, the agent's line arrives, and the
 * result draws in a piece at a time.
 */
export interface ReplayFrame {
  /** How many characters of the prompt are typed. */
  typed: number;
  /** How many steps are shown. */
  steps: number;
  /** Whether the last shown step is still running. */
  running: boolean;
  /** Whether the agent's line is shown. */
  answered: boolean;
  /** How many pieces of the result are drawn. */
  pieces: number;
  /** How long this frame stays before the next. */
  holdMs: number;
}

export const REPLAY_TIMING = {
  typeMs: 28,
  afterPromptMs: 500,
  stepRunMs: 900,
  stepDoneMs: 450,
  answerMs: 600,
  pieceMs: 380,
} as const;

/** How many pieces a result draws in: a line, a row, or the created thing's
 * title and then its lines. */
export function resultPieces(result: UseCaseResult): number {
  if (result.kind === "text") return result.lines.length;
  if (result.kind === "table") return result.rows.length;
  return 1 + result.lines.length;
}

/** The result with only its first `pieces` drawn, as the markdown the chat
 * renders. A table keeps its header from the first row on. */
export function partialResultMarkdown(result: UseCaseResult, pieces: number): string {
  if (pieces <= 0) return "";
  if (result.kind === "text") return result.lines.slice(0, pieces).map((l) => `- ${l}`).join("\n");
  if (result.kind === "table") {
    const row = (cells: string[]) => `| ${cells.join(" | ")} |`;
    return [row(result.columns), row(result.columns.map(() => "---")), ...result.rows.slice(0, pieces).map(row)].join("\n");
  }
  return [`**${result.what}: ${result.title}**`, "", ...result.lines.slice(0, pieces - 1).map((l) => `- ${l}`)].join("\n").trimEnd();
}

export function replayTimeline(useCase: Pick<UseCase, "prompt" | "steps" | "result">): ReplayFrame[] {
  const t = REPLAY_TIMING;
  const frames: ReplayFrame[] = [];
  const base = { steps: 0, running: false, answered: false, pieces: 0 };
  // The prompt, a few characters at a time so a long one does not crawl.
  const stride = Math.max(1, Math.ceil(useCase.prompt.length / 60));
  for (let typed = 0; typed < useCase.prompt.length; typed += stride) {
    frames.push({ ...base, typed, holdMs: t.typeMs });
  }
  const typed = useCase.prompt.length;
  frames.push({ ...base, typed, holdMs: t.afterPromptMs });
  for (let i = 1; i <= useCase.steps.length; i++) {
    frames.push({ ...base, typed, steps: i, running: true, holdMs: t.stepRunMs });
    frames.push({ ...base, typed, steps: i, running: false, holdMs: t.stepDoneMs });
  }
  const steps = useCase.steps.length;
  frames.push({ typed, steps, running: false, answered: true, pieces: 0, holdMs: t.answerMs });
  const total = resultPieces(useCase.result);
  for (let pieces = 1; pieces <= total; pieces++) {
    frames.push({ typed, steps, running: false, answered: true, pieces, holdMs: t.pieceMs });
  }
  return frames;
}

/** The finished conversation: what shows before the replay starts, after it
 * ends, and always under reduced motion. */
export function finishedFrame(useCase: Pick<UseCase, "prompt" | "steps" | "result">): ReplayFrame {
  return {
    typed: useCase.prompt.length,
    steps: useCase.steps.length,
    running: false,
    answered: true,
    pieces: resultPieces(useCase.result),
    holdMs: 0,
  };
}
