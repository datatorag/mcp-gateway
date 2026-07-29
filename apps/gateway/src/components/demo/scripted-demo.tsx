"use client";

/** Looping playback of one scripted demo window (the transcript area only —
 * the card shell and header are server-rendered by demo-section).
 *
 * Renders the playground's REAL presentation components (MessageRow,
 * ToolCard, ConfirmCard) from authored data — see demo-scripts.ts. Nothing
 * here talks to a server: no MCP calls, no API routes, no LLM, no network
 * requests of any kind; Approve/Deny on the ConfirmCard are pure client-side
 * state transitions. Deliberately NO text input affordance — an input that
 * swallows typing would misrepresent the demo as a live chat.
 *
 * Motion is bounded: playback pauses whenever the window is scrolled out of
 * the viewport, and prefers-reduced-motion renders the completed end state
 * with no playback at all.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MessageRow } from "@/app/dashboard/playground-presentation";
import type { PlaygroundMessage } from "@/app/dashboard/playground-presentation";
import { DEMO_SCRIPTS, type DemoScript } from "./demo-scripts";
import {
  buildMessages,
  finishedState,
  useScriptPlayer,
} from "./use-script-player";

const noop = () => {};
const EMPTY: Record<string, never> = {};

/** How long a window rests on its resolved state before looping. */
const REST_MS = 6000;

/** The transcript rows, top-anchored: the conversation grows downward from
 * the top of the fixed frame, so any spare room in shorter states sits at
 * the bottom and reads as room to grow. */
function Transcript({
  messages,
  awaitingApproval,
  onDecide,
}: {
  messages: PlaygroundMessage[];
  awaitingApproval: boolean;
  onDecide: (approvalId: string, approved: boolean) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Frames are sized to each script's measured peak, but keep the newest
  // beat in view if content ever runs a few pixels over.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div
      className="h-full overflow-y-auto overscroll-contain p-4"
      ref={scrollRef}
    >
      {messages.map((message, index) => (
        <MessageRow
          awaitingConfirm={awaitingApproval}
          busy={false}
          comments={EMPTY}
          feedback={EMPTY}
          isLast={index === messages.length - 1}
          key={message.id}
          message={message}
          onCommentChange={noop}
          onDecide={onDecide}
          onRate={noop}
          onRegenerate={noop}
          onSendComment={noop}
          showActions={false}
        />
      ))}
    </div>
  );
}

function Playback({
  script,
  active,
  onDone,
}: {
  script: DemoScript;
  active: boolean;
  onDone: () => void;
}) {
  const { messages, phase, awaitingApproval, onDecide } = useScriptPlayer(
    script,
    active
  );

  useEffect(() => {
    if (phase === "done") onDone();
  }, [phase, onDone]);

  return (
    <Transcript
      awaitingApproval={awaitingApproval}
      messages={messages}
      onDecide={onDecide}
    />
  );
}

/** Lifecycle: rest on the completed end state through the initial stagger →
 * play the script live → rest on the resolved state → remount and play
 * again. All timers pause off-screen. The scripts' differing run lengths
 * keep the three windows out of sync once the stagger has separated them. */
export default function ScriptedTranscript({
  id,
  startDelayMs,
}: {
  id: string;
  startDelayMs: number;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  // Pause whenever the window is scrolled out of view; resume on return.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) =>
      setVisible(entries.some((e) => e.isIntersecting))
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const [reducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  // started=false renders the completed end state (initial stagger, and
  // permanently under reduced motion). `run` remounts Playback per loop.
  const [started, setStarted] = useState(startDelayMs === 0);
  const [run, setRun] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (started || reducedMotion || !visible) return;
    const t = setTimeout(() => setStarted(true), startDelayMs);
    return () => clearTimeout(t);
  }, [started, reducedMotion, visible, startDelayMs]);

  const handleDone = useCallback(() => setDone(true), []);
  useEffect(() => {
    if (!done || !visible) return;
    const t = setTimeout(() => {
      setDone(false);
      setRun((r) => r + 1);
    }, REST_MS);
    return () => clearTimeout(t);
  }, [done, visible]);

  const script = DEMO_SCRIPTS.find((s) => s.id === id);
  const restingMessages = useMemo(
    () => (script ? buildMessages(script, finishedState(script)) : []),
    [script]
  );
  if (!script) return null;

  const playing = started && !reducedMotion;

  return (
    <div className="h-full" ref={rootRef}>
      {playing ? (
        <Playback
          active={visible}
          key={run}
          onDone={handleDone}
          script={script}
        />
      ) : (
        <Transcript
          awaitingApproval={false}
          messages={restingMessages}
          onDecide={noop}
        />
      )}
    </div>
  );
}
