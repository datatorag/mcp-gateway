"use client";

/** The landing page's scripted playground demo.
 *
 * Renders the playground's REAL presentation components (MessageRow,
 * ToolCard, ConfirmCard) from authored data — see demo-scripts.ts. Nothing
 * here talks to a server: no MCP calls, no API routes, no LLM; Approve/Deny
 * on the ConfirmCard are pure client-side state transitions. Deliberately NO
 * text input affordance — an input that swallows typing would misrepresent
 * the demo as a live chat.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { RefreshCcwIcon } from "lucide-react";
import { MessageRow } from "@/app/dashboard/playground-presentation";
import { DEMO_SCRIPTS } from "./demo-scripts";
import { useScriptPlayer } from "./use-script-player";

const noop = () => {};
const NO_ERRORED_IDS = { has: () => false } as unknown as ReadonlySet<string>;
const EMPTY: Record<string, never> = {};

function Playback({
  scriptIndex,
  active,
}: {
  scriptIndex: number;
  active: boolean;
}) {
  const script = DEMO_SCRIPTS[scriptIndex % DEMO_SCRIPTS.length];
  const { messages, awaitingApproval, onDecide } = useScriptPlayer(
    script,
    active
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the latest beat in view as content grows inside the fixed frame.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div
      className="h-[420px] overflow-y-auto overscroll-contain p-4"
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

export default function ScriptedDemo() {
  // Playback starts when the demo scrolls near the viewport, not on load.
  const rootRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setActive(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setActive(true);
          observer.disconnect();
        }
      },
      { rootMargin: "120px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Replay cycles scripts (Sheets → Gmail → Jira → …): breadth is shown,
  // not claimed. The remount (key) resets the player completely.
  const [run, setRun] = useState(0);

  return (
    <div
      className="overflow-hidden rounded-2xl border border-border bg-background text-left shadow-2xl"
      ref={rootRef}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Scripted demo · sample data
        </span>
        <button
          className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          onClick={() => setRun((r) => r + 1)}
          type="button"
        >
          <RefreshCcwIcon className="size-3" />
          Replay
        </button>
      </div>
      <Playback active={active} key={run} scriptIndex={run} />
    </div>
  );
}
