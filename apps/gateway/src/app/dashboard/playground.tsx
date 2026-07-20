"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { EngineEvent } from "@/gateway/playground/engine";

// fetch()/reader.read() reject with this when the request's AbortController
// fires — treat it as a silent no-op rather than a connection error, since
// it means the component unmounted or a newer send superseded this one.
function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

export interface PlaygroundHandle {
  /** Seed the input with `prompt` and submit it immediately. Used by the
   * "What can I do?" prompt cards' Run action in dashboard-client.tsx. */
  runPrompt: (prompt: string) => void;
}

type ToolChip = { name: string; done: boolean; isError: boolean };

interface UserTurn {
  role: "user";
  text: string;
}

interface AssistantTurn {
  role: "assistant";
  text: string;
  tools: ToolChip[];
  /** Set once the turn's `done` event lands. Feedback controls only render
   * for completed, non-error turns. */
  complete: boolean;
  errorText?: string;
  /** The user message that produced this turn — sent back as `prompt` on
   * feedback submission. */
  prompt: string;
}

type Turn = UserTurn | AssistantTurn;

type FeedbackState = "idle" | "down-pending" | "sending" | "thanks";

interface PlaygroundProps {
  /** Example prompts, offered as quick-start chips in the empty state. */
  prompts: string[];
  /** Whether the user has at least one connected account (any service). */
  hasConnectedAccount: boolean;
}

// Builds the {role, content}[] payload the SSE contract expects from prior
// turns — assistant turns that ended in an error are excluded (no real
// assistant content to replay back as conversation history).
function buildApiMessages(
  turns: Turn[]
): { role: "user" | "assistant"; content: string }[] {
  return turns
    .filter(
      (t) => t.role === "user" || (t.role === "assistant" && t.text.trim() && !t.errorText)
    )
    .map((t) => ({ role: t.role, content: t.text }));
}

export const Playground = forwardRef<PlaygroundHandle, PlaygroundProps>(
  function Playground({ prompts, hasConnectedAccount }, ref) {
    const [turns, setTurns] = useState<Turn[]>([]);
    const [input, setInput] = useState("");
    const [streaming, setStreaming] = useState(false);
    const [capState, setCapState] = useState<{ cap: number } | null>(null);
    const [hidden, setHidden] = useState(false);
    const [feedback, setFeedback] = useState<Record<number, FeedbackState>>({});
    const [comments, setComments] = useState<Record<number, string>>({});
    // Mirrors `streaming` state but readable synchronously inside `send`
    // (state updates are async, and the guard at the top of `send` needs
    // the up-to-date value immediately, including for back-to-back
    // runPrompt calls before a re-render happens).
    const streamingRef = useRef(false);
    // Aborts the in-flight fetch/stream for the current send, so a
    // component unmount (or a new send superseding this one) doesn't leave
    // the request running or write state after the fact.
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
      return () => {
        abortRef.current?.abort();
      };
    }, []);

    function updateLastAssistant(updater: (t: AssistantTurn) => AssistantTurn) {
      setTurns((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== "assistant") return prev;
        return [...prev.slice(0, -1), updater(last)];
      });
    }

    function handleEvent(event: EngineEvent) {
      if (event.type === "text") {
        updateLastAssistant((t) => ({ ...t, text: t.text + event.text }));
      } else if (event.type === "tool_start") {
        updateLastAssistant((t) => ({
          ...t,
          tools: [...t.tools, { name: event.name, done: false, isError: false }],
        }));
      } else if (event.type === "tool_done") {
        updateLastAssistant((t) => {
          // Match the most recent still-running chip with this name (tools
          // can repeat within a turn, e.g. gmail_search called twice).
          const revIdx = [...t.tools].reverse().findIndex(
            (c) => c.name === event.name && !c.done
          );
          if (revIdx === -1) return t;
          const idx = t.tools.length - 1 - revIdx;
          return {
            ...t,
            tools: t.tools.map((c, i) =>
              i === idx ? { ...c, done: true, isError: event.isError } : c
            ),
          };
        });
      } else if (event.type === "error") {
        updateLastAssistant((t) => ({
          ...t,
          errorText: event.message
            ? `Something went wrong: ${event.message}`
            : "Something went wrong. Please try again.",
        }));
      } else if (event.type === "done") {
        updateLastAssistant((t) => ({ ...t, complete: true }));
      }
    }

    async function send(raw: string) {
      const trimmed = raw.trim();
      if (
        !trimmed ||
        streamingRef.current ||
        capState ||
        hidden ||
        !hasConnectedAccount
      ) {
        return;
      }

      // Defensive: cancel any prior in-flight request before starting a new
      // one. The streamingRef guard above already prevents overlapping
      // sends, but this keeps a stray in-flight controller from lingering.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const apiMessages = [
        ...buildApiMessages(turns),
        { role: "user" as const, content: trimmed },
      ];

      // Appends this send's assistant turn; with errorText set it renders as
      // a failed turn (no feedback controls).
      const pushAssistantTurn = (errorText?: string) =>
        setTurns((prev) => [
          ...prev,
          { role: "assistant", text: "", tools: [], complete: false, prompt: trimmed, errorText },
        ]);

      setTurns((prev) => [...prev, { role: "user", text: trimmed }]);
      setInput("");
      setStreaming(true);
      streamingRef.current = true;

      try {
        let res: Response;
        try {
          res = await fetch("/api/playground/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: apiMessages }),
            signal: controller.signal,
          });
        } catch (err) {
          if (!isAbortError(err)) {
            pushAssistantTurn("Connection lost. Please try again.");
          }
          return;
        }

        if (res.status === 403) {
          // playground_disabled — hide the section entirely rather than show
          // a dead chat box.
          setHidden(true);
          return;
        }

        if (res.status === 429) {
          const data = (await res.json().catch(() => null)) as { cap?: number } | null;
          setCapState({ cap: typeof data?.cap === "number" ? data.cap : 0 });
          return;
        }

        if (!res.ok || !res.body) {
          pushAssistantTurn("Something went wrong. Please try again.");
          return;
        }

        pushAssistantTurn();

        function processFrame(part: string) {
          const line = part.trim();
          if (!line.startsWith("data:")) return;
          const jsonStr = line.slice("data:".length).trim();
          if (!jsonStr) return;
          try {
            handleEvent(JSON.parse(jsonStr) as EngineEvent);
          } catch {
            // Malformed frame — skip it rather than aborting the stream.
          }
        }

        try {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          // Buffer partial SSE frames — a `\n\n` boundary can straddle two
          // chunk-boundary reads, and a single chunk can contain multiple
          // complete events.
          let buffer = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split("\n\n");
            buffer = parts.pop() ?? "";
            for (const part of parts) processFrame(part);
          }
          // Flush any bytes the decoder held back for a multi-byte sequence,
          // then process whatever's left in the buffer — the stream can end
          // without a trailing `\n\n`, and that final frame shouldn't be
          // silently dropped.
          buffer += decoder.decode();
          for (const part of buffer.split("\n\n")) processFrame(part);
        } catch (err) {
          if (!isAbortError(err)) {
            updateLastAssistant((t) => ({
              ...t,
              errorText: "Connection lost while responding. Please try again.",
            }));
          }
        }
      } finally {
        setStreaming(false);
        streamingRef.current = false;
      }
    }

    useImperativeHandle(ref, () => ({
      runPrompt: (prompt: string) => {
        void send(prompt);
      },
    }));

    function giveFeedback(idx: number, rating: "up" | "down") {
      if (rating === "down") {
        setFeedback((f) => ({ ...f, [idx]: "down-pending" }));
        return;
      }
      void submitFeedback(idx, "up");
    }

    async function submitFeedback(idx: number, rating: "up" | "down") {
      const turn = turns[idx];
      if (!turn || turn.role !== "assistant") return;
      setFeedback((f) => ({ ...f, [idx]: "sending" }));
      try {
        await fetch("/api/playground/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rating,
            comment: comments[idx]?.trim() || undefined,
            prompt: turn.prompt,
          }),
        });
      } catch {
        // Never block the UI on a feedback-submission failure.
      }
      setFeedback((f) => ({ ...f, [idx]: "thanks" }));
    }

    if (hidden) return null;

    return (
      <div className="mt-8">
        <h2 className="font-display text-base font-bold text-foreground">
          Playground
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Chat with your connected accounts, right here.
        </p>

        <div className="relative mt-3 rounded-xl border border-border">
          {!hasConnectedAccount && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background/90 p-4 text-center backdrop-blur-sm">
              <p className="text-xs font-medium text-muted-foreground">
                Connect Google Workspace above to try it
              </p>
            </div>
          )}

          <div className="max-h-[28rem] min-h-[8rem] space-y-4 overflow-y-auto p-4">
            {turns.length === 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Ask something about your connected accounts.
                </p>
                {hasConnectedAccount && (
                  <div className="flex flex-wrap gap-1.5">
                    {prompts.slice(0, 3).map((prompt, i) => (
                      <button
                        key={i}
                        onClick={() => void send(prompt)}
                        className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/30 hover:bg-secondary/50"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {turns.map((turn, idx) =>
              turn.role === "user" ? (
                <div key={idx} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl bg-primary px-3 py-2 text-xs text-primary-foreground">
                    {turn.text}
                  </div>
                </div>
              ) : (
                <div key={idx} className="flex justify-start">
                  <div className="max-w-[85%] space-y-2">
                    {turn.tools.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {turn.tools.map((tool, ti) => (
                          <span
                            key={ti}
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] ${
                              !tool.done
                                ? "bg-secondary text-muted-foreground"
                                : tool.isError
                                  ? "bg-red-50 text-red-700"
                                  : "bg-emerald-500/10 text-emerald-600"
                            }`}
                          >
                            {!tool.done
                              ? `🔍 ${tool.name}…`
                              : tool.isError
                                ? `✕ ${tool.name}`
                                : `✓ ${tool.name}`}
                          </span>
                        ))}
                      </div>
                    )}

                    {turn.text && (
                      <div className="whitespace-pre-wrap rounded-2xl border border-border bg-secondary/40 px-3 py-2 text-xs text-foreground">
                        {turn.text}
                      </div>
                    )}

                    {turn.errorText && (
                      <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                        {turn.errorText}
                      </div>
                    )}

                    {turn.complete && !turn.errorText && (
                      <div className="flex flex-wrap items-center gap-2 pl-1">
                        {feedback[idx] === "thanks" ? (
                          <span className="text-[11px] text-muted-foreground">
                            Thanks for the feedback
                          </span>
                        ) : (
                          <>
                            <button
                              onClick={() => giveFeedback(idx, "up")}
                              aria-label="Good response"
                              disabled={feedback[idx] === "sending"}
                              className="text-xs opacity-60 transition-opacity hover:opacity-100 disabled:opacity-30"
                            >
                              👍
                            </button>
                            <button
                              onClick={() => giveFeedback(idx, "down")}
                              aria-label="Bad response"
                              disabled={feedback[idx] === "sending"}
                              className="text-xs opacity-60 transition-opacity hover:opacity-100 disabled:opacity-30"
                            >
                              👎
                            </button>
                            {feedback[idx] === "down-pending" && (
                              <div className="flex items-center gap-1.5">
                                <input
                                  value={comments[idx] ?? ""}
                                  onChange={(e) =>
                                    setComments((c) => ({ ...c, [idx]: e.target.value }))
                                  }
                                  placeholder="What went wrong? (optional)"
                                  className="rounded-md border border-border px-2 py-1 text-[11px] text-foreground"
                                />
                                <button
                                  onClick={() => void submitFeedback(idx, "down")}
                                  className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary"
                                >
                                  Send
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            )}
          </div>

          <div className="border-t border-border p-3">
            {capState ? (
              <div className="rounded-lg bg-secondary/40 p-3 text-center">
                <p className="text-xs text-foreground">
                  You&apos;ve used your {capState.cap} playground runs — connect Claude to
                  keep going
                </p>
                <button
                  onClick={() =>
                    document
                      .getElementById("setup-wizard")
                      ?.scrollIntoView({ behavior: "smooth" })
                  }
                  className="mt-2 rounded-[var(--radius)] bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Connect Claude
                </button>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void send(input);
                }}
                className="flex gap-2"
              >
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={streaming || !hasConnectedAccount}
                  placeholder={
                    hasConnectedAccount
                      ? "Ask something…"
                      : "Connect an account to try the playground"
                  }
                  className="flex-1 rounded-[var(--radius)] border border-border px-3 py-2 text-xs text-foreground disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={streaming || !hasConnectedAccount || !input.trim()}
                  className="shrink-0 rounded-[var(--radius)] bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {streaming ? "…" : "Send"}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    );
  }
);
