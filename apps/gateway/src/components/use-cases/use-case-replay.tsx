"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PauseIcon, PlayIcon, RotateCcwIcon } from "lucide-react";
import { MessageRow, ToolCard } from "@/app/dashboard/playground-presentation";
import type { AnyToolPart, PlaygroundMessage } from "@/app/dashboard/playground-presentation";
import type { UseCase } from "@/lib/use-cases";
import { finishedFrame, partialResultMarkdown, replayTimeline, resultPieces, type ReplayFrame } from "./replay-timeline";

/**
 * The chat replay on a use case's page (SCRUM-514): the prompt types itself,
 * the agent's steps appear one at a time with each tool's plain label and
 * its real name, and the result draws in. It is the site's own chat parts
 * (`MessageRow`, `ToolCard`) fed authored data from the record. Nothing here
 * talks to a server, and there is no input: it is a replay, not a chat.
 *
 * - The server's HTML, and the first paint, is the finished conversation, so
 *   the words are in the page before any script runs.
 * - It starts once, the first time it is on screen, and stops at the end. It
 *   never loops. Play, pause, and replay are buttons.
 * - With reduced motion it never moves and shows no controls: the finished
 *   conversation is all there is.
 * - The frame has a fixed height, so nothing around it shifts as it plays.
 */

const noop = () => {};
const EMPTY: Record<string, never> = {};

function toolPart(tool: string, label: string, index: number, running: boolean): AnyToolPart {
  const base = { type: `tool-${tool}` as const, toolCallId: `use-case-step-${index}`, input: {} };
  return running
    ? { ...base, state: "input-available" }
    : { ...base, state: "output-available", output: { content: [{ type: "text", text: label }] } };
}

function Row({ message, isLast }: { message: PlaygroundMessage; isLast: boolean }) {
  return (
    <MessageRow
      awaitingConfirm={false}
      busy={false}
      comments={EMPTY}
      feedback={EMPTY}
      isLast={isLast}
      message={message}
      onCommentChange={noop}
      onDecide={noop}
      onRate={noop}
      onRegenerate={noop}
      onSendComment={noop}
      showActions={false}
    />
  );
}

function Conversation({ useCase, frame }: { useCase: UseCase; frame: ReplayFrame }) {
  const typed = useCase.prompt.slice(0, frame.typed);
  const result = partialResultMarkdown(useCase.result, frame.pieces);
  return (
    <>
      {typed.length > 0 && (
        <Row isLast={false} message={{ id: "use-case-prompt", role: "user", parts: [{ type: "text", text: typed }] }} />
      )}
      {frame.steps > 0 && (
        <ol className="my-3 space-y-2" data-replay-steps="">
          {useCase.steps.slice(0, frame.steps).map((step, i) => (
            <li key={i}>
              <p className="mb-1 text-xs text-muted-foreground">{step.label}</p>
              <ToolCard part={toolPart(step.tool, step.label, i, frame.running && i === frame.steps - 1)} />
            </li>
          ))}
        </ol>
      )}
      {frame.answered && (
        <Row
          isLast
          message={{
            id: "use-case-answer",
            role: "assistant",
            parts: [{ type: "text", text: result ? `${useCase.answer}\n\n${result}` : useCase.answer }],
          }}
        />
      )}
    </>
  );
}

/** Room for the whole finished conversation: the prompt, a row per step, the
 * answer, and a line per piece of the result. Bounded, so a very long record
 * scrolls inside the frame instead of taking over the page. */
export function frameHeight(useCase: Pick<UseCase, "steps" | "result">): string {
  const rem = 9 + useCase.steps.length * 4.75 + resultPieces(useCase.result) * 2.25 + (useCase.result.kind === "table" ? 3 : 0);
  return `${Math.min(46, Math.max(20, Math.ceil(rem)))}rem`;
}

export function UseCaseReplay({ useCase }: { useCase: UseCase }) {
  const frames = useMemo(() => replayTimeline(useCase), [useCase]);
  const finished = useMemo(() => finishedFrame(useCase), [useCase]);
  // null: at rest on the finished conversation. A number: playing or paused at that frame.
  const [at, setAt] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const started = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setReducedMotion(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  }, []);

  // Start once, the first time the replay is on screen.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || reducedMotion || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || started.current) return;
        // Asked again at the moment it would start, not only at mount.
        if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
        started.current = true;
        setAt(0);
      },
      { threshold: 0.5 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [reducedMotion]);

  // The clock: one timer per frame, and none while paused or at rest.
  useEffect(() => {
    if (at === null || paused || reducedMotion) return;
    const timer = setTimeout(() => setAt(at + 1 < frames.length ? at + 1 : null), frames[at].holdMs);
    return () => clearTimeout(timer);
  }, [at, paused, reducedMotion, frames]);

  const playing = at !== null;
  const frame = playing ? frames[at] : finished;

  // While it plays, the newest line stays in view; at rest the top does.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = playing ? el.scrollHeight : 0;
  }, [frame, playing]);

  const button = "inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-secondary";

  return (
    <div ref={boxRef} className="overflow-hidden rounded-2xl border border-border bg-background" data-use-case-replay={playing ? (paused ? "paused" : "playing") : "finished"}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <p className="text-xs font-medium text-muted-foreground">A replay of this request. Sample content.</p>
        {!reducedMotion && (
          <div className="flex gap-2">
            {playing && (
              <button type="button" className={button} onClick={() => setPaused((p) => !p)}>
                {paused ? <PlayIcon aria-hidden="true" className="size-3.5" /> : <PauseIcon aria-hidden="true" className="size-3.5" />}
                {paused ? "Play" : "Pause"}
              </button>
            )}
            <button
              type="button"
              className={button}
              onClick={() => {
                started.current = true;
                setPaused(false);
                setAt(0);
              }}
            >
              <RotateCcwIcon aria-hidden="true" className="size-3.5" />
              Replay
            </button>
          </div>
        )}
      </div>
      {/* A fixed height, worked out from the record and the same from the
          first paint to the last frame: the conversation grows inside it and
          nothing below moves. */}
      <div ref={scrollRef} className="overflow-y-auto p-4" style={{ height: frameHeight(useCase) }} aria-live="off">
        <Conversation frame={frame} useCase={useCase} />
      </div>
    </div>
  );
}
