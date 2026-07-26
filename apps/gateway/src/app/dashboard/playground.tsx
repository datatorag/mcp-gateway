"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { Button } from "@/components/ui/button";
import type { Decision, PendingWrite } from "@/gateway/playground/engine";
import {
  errorBubbleText,
  GENERIC_ERROR,
  MessageList,
  messageText,
  type FeedbackState,
  type PlaygroundMessage,
} from "./playground-presentation";

export interface PlaygroundHandle {
  /** Seed the input with `prompt` and submit it immediately. Used by the
   * "What can I do?" prompt cards' Run action in dashboard-client.tsx. */
  runPrompt: (prompt: string) => void;
}

interface PlaygroundProps {
  /** Example prompts, offered as quick-start chips in the empty state. */
  prompts: string[];
  /** Whether the user has at least one connected account (any service). */
  hasConnectedAccount: boolean;
}

/** Feedback is reported against the prompt that produced the answer, which is
 * the nearest USER message before this assistant message in the list. */
function precedingUserPrompt(
  messages: PlaygroundMessage[],
  messageId: string
): string {
  const index = messages.findIndex((m) => m.id === messageId);
  for (let i = index - 1; i >= 0; i--) {
    const candidate = messages[i];
    if (candidate.role === "user") return messageText(candidate);
  }
  return "";
}

/* -------------------------------------------------------------------------- */
/* Container — the only place that knows about useChat                         */
/* -------------------------------------------------------------------------- */

export const Playground = forwardRef<PlaygroundHandle, PlaygroundProps>(
  function Playground({ prompts, hasConnectedAccount }, ref) {
    const [input, setInput] = useState("");
    const [capState, setCapState] = useState<{ cap: number } | null>(null);
    const [hidden, setHidden] = useState(false);
    // Confirm resolution is CLIENT-LOCAL: the server hands out a one-shot
    // resume token and never rewrites the original `data-confirm` part, so the
    // only record that the user already decided lives here.
    const [resolvedTokens, setResolvedTokens] = useState<
      ReadonlyMap<string, Decision>
    >(() => new Map());
    const [feedback, setFeedback] = useState<Record<string, FeedbackState>>({});
    const [comments, setComments] = useState<Record<string, string>>({});
    const [erroredIds, setErroredIds] = useState<ReadonlySet<string>>(
      () => new Set()
    );

    const transport = useMemo(
      () =>
        new DefaultChatTransport<PlaygroundMessage>({
          api: "/api/playground/chat",
          // The route answers pre-stream failures with plain JSON, never with
          // stream frames — so they are intercepted here, before the UI-message
          // stream parser ever sees the body. Throwing puts useChat into its
          // error state; 403/429 additionally flip local state that suppresses
          // the generic error bubble in favour of a dedicated panel.
          fetch: async (url, init) => {
            let res: Response;
            try {
              res = await fetch(url, init);
            } catch (err) {
              // An abort is normal (stop(), or unmount cleanup) — pass it
              // through untouched. Anything else is a connection failure and
              // must not surface a raw browser string in the error bubble.
              if (err instanceof DOMException && err.name === "AbortError") {
                throw err;
              }
              throw new Error(GENERIC_ERROR);
            }
            if (res.status === 403) {
              setHidden(true);
              throw new Error("playground_disabled");
            }
            if (res.status === 429) {
              const data = (await res.json().catch(() => null)) as {
                cap?: number;
              } | null;
              setCapState({ cap: typeof data?.cap === "number" ? data.cap : 0 });
              throw new Error("cap_exceeded");
            }
            // 400 / 500 (and anything else non-2xx) land in the chat error
            // state. The thrown message IS the user-facing copy, because the
            // error bubble renders `error.message` verbatim so that the
            // route's own actionable text (e.g. the expired-resume-token
            // stream) survives — a sentinel like "request_failed" would be
            // rendered to the user as-is.
            if (!res.ok) throw new Error(GENERIC_ERROR);
            return res;
          },
          // Two request shapes on one endpoint: a fresh turn posts the message
          // list; resuming a paused turn posts only the server-held token plus
          // the user's decisions (see `resolveConfirm`).
          prepareSendMessagesRequest: ({ messages, body }) =>
            body && typeof body.resumeToken === "string"
              ? {
                  body: {
                    resumeToken: body.resumeToken,
                    decisions: body.decisions,
                  },
                }
              : { body: { messages } },
        }),
      []
    );

    const { messages, sendMessage, stop, regenerate, status, error } =
      useChat<PlaygroundMessage>({ transport });

    const streaming = status === "submitted" || status === "streaming";

    // `status` is a render snapshot, so two synchronous calls (e.g. two rapid
    // runPrompt clicks) would both pass the streaming guard and fire two
    // overlapping requests — the SDK does not serialize them. This ref closes
    // that window; it is not a turn state machine.
    const busyRef = useRef(false);
    const runExclusive = useCallback(async (fn: () => Promise<void>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        await fn();
      } finally {
        busyRef.current = false;
      }
    }, []);

    // Abort any in-flight stream on unmount, so navigating away mid-turn
    // doesn't leave the request running and firing no-op state setters.
    useEffect(() => () => void stop(), [stop]);

    // A turn that ends in an error gets no feedback controls. `status` alone
    // can't express this once the next turn clears the error, so the failed
    // message id is remembered.
    useEffect(() => {
      if (status !== "error") return;
      const last = messages[messages.length - 1];
      if (!last || last.role !== "assistant") return;
      setErroredIds((prev) =>
        prev.has(last.id) ? prev : new Set(prev).add(last.id)
      );
    }, [status, messages]);

    // An unresolved write-confirmation owns the conversation: it locks the
    // composer and regenerate until the user approves or denies.
    const awaitingConfirm = useMemo(
      () =>
        messages.some((message) =>
          message.parts.some(
            (part) =>
              part.type === "data-confirm" &&
              !resolvedTokens.has(part.data.resumeToken)
          )
        ),
      [messages, resolvedTokens]
    );

    const send = useCallback(
      (raw: string) => {
        const text = raw.trim();
        if (
          !text ||
          streaming ||
          busyRef.current ||
          capState ||
          hidden ||
          !hasConnectedAccount ||
          awaitingConfirm
        ) {
          return;
        }
        // Clear only once the call is actually going out — `runExclusive`
        // drops a re-entrant call, and clearing first would eat the text.
        void runExclusive(async () => {
          setInput("");
          await sendMessage({ text });
        });
      },
      [
        streaming,
        capState,
        hidden,
        hasConnectedAccount,
        awaitingConfirm,
        runExclusive,
        sendMessage,
      ]
    );

    /** Approve or deny every write in a paused batch, then resume the turn.
     *
     * `sendMessage(undefined, …)` fires a request WITHOUT appending a user
     * message — the continuation streams straight into the paused assistant
     * message. `regenerate()` would be wrong here: it drops the last assistant
     * message, destroying the paused turn the resume token refers to. */
    const resolveConfirm = useCallback(
      (resumeToken: string, pending: PendingWrite[], decision: Decision) => {
        if (streaming || busyRef.current) return;
        // `Object.fromEntries` (not `obj[key] = …`) so a hostile write id such
        // as "__proto__" becomes an own property instead of mutating a prototype.
        const decisions = Object.fromEntries(
          pending.map((write) => [write.id, decision])
        );
        // Marking the token resolved must happen INSIDE the exclusive section:
        // `runExclusive` drops a re-entrant call, and recording the decision
        // for a resume that never fires would flip the card to "approved" and
        // unlock the composer while stranding the paused turn forever.
        void runExclusive(async () => {
          setResolvedTokens((prev) => new Map(prev).set(resumeToken, decision));
          await sendMessage(undefined, { body: { resumeToken, decisions } });
        });
      },
      [streaming, runExclusive, sendMessage]
    );

    useImperativeHandle(ref, () => ({ runPrompt: send }), [send]);

    // `submitFeedback` (and, transitively, `handleRate`/`handleSendComment`,
    // both passed to every memoized `MessageRow`) must not be recreated on
    // every streamed token just because it reads `messages`/`comments` — those
    // reads only matter at click time, not render time. Track the latest
    // values in refs instead of closing over the state directly, so the
    // callback's identity stays stable across renders (deps: none) while
    // still reading current data at call time.
    const messagesRef = useRef(messages);
    useEffect(() => {
      messagesRef.current = messages;
    }, [messages]);
    const commentsRef = useRef(comments);
    useEffect(() => {
      commentsRef.current = comments;
    }, [comments]);

    const submitFeedback = useCallback((messageId: string, rating: "up" | "down") => {
      const prompt = precedingUserPrompt(messagesRef.current, messageId);
      const comment = commentsRef.current[messageId]?.trim() || undefined;
      setFeedback((prev) => ({ ...prev, [messageId]: "sending" }));
      void (async () => {
        try {
          await fetch("/api/playground/feedback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rating, comment, prompt }),
          });
        } catch {
          // Never block the UI on a feedback-submission failure.
        }
        setFeedback((prev) => ({ ...prev, [messageId]: "thanks" }));
      })();
    }, []);

    const handleRate = useCallback(
      (messageId: string, rating: "up" | "down") => {
        if (rating === "down") {
          setFeedback((prev) => ({ ...prev, [messageId]: "down-pending" }));
          return;
        }
        submitFeedback(messageId, "up");
      },
      [submitFeedback]
    );

    const handleCommentChange = useCallback((messageId: string, value: string) => {
      setComments((prev) => ({ ...prev, [messageId]: value }));
    }, []);

    const handleSendComment = useCallback(
      (messageId: string) => submitFeedback(messageId, "down"),
      [submitFeedback]
    );

    const handleRegenerate = useCallback(() => {
      if (streaming || awaitingConfirm) return;
      void runExclusive(() => regenerate());
    }, [streaming, awaitingConfirm, runExclusive, regenerate]);

    // 403 playground_disabled — hide the section entirely rather than show a
    // dead chat box.
    if (hidden) return null;

    const placeholder = awaitingConfirm
      ? "Approve or deny the action above to continue"
      : hasConnectedAccount
        ? "Ask something…"
        : "Connect an account to try the playground";

    return (
      <div className="mt-8">
        <h2 className="font-display text-base font-bold text-foreground">
          Playground
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Chat with your connected accounts, right here.
        </p>

        {/* Grid, not flex, on purpose: this panel has only a max-height (it
            grows with content up to the cap), never an explicit height. A
            flex column's `flex-1` child never gets a *definite* height out
            of that — `height:100%` on `use-stick-to-bottom`'s inner scroller
            (rendered by <Conversation>) falls back to content height, so it
            never scrolls and the outer `overflow-y-hidden` silently clips
            (verified live: inner grew to 1131px inside a 429px box). CSS
            Grid's row-sizing algorithm gives the `minmax(0,1fr)` row a
            genuinely definite size even when the grid container's own
            height is intrinsic, so the log row — and therefore the
            inner scroller's `height:100%` — resolves correctly once content
            exceeds the cap, while still shrinking to content (down to
            min-height) for short conversations. Verified in a standalone
            harness reproducing this exact class structure (see
            conversation-scroll-fix.md). */}
        <div className="relative mt-3 grid max-h-[34rem] min-h-[12rem] grid-rows-[minmax(0,1fr)_auto] rounded-xl border border-border">
          {!hasConnectedAccount && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background/90 p-4 text-center backdrop-blur-sm">
              <p className="text-xs font-medium text-muted-foreground">
                Connect Google Workspace above to try it
              </p>
            </div>
          )}

          <Conversation className="min-h-0">
            <ConversationContent className="gap-4 p-4">
              {messages.length === 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Ask something about your connected accounts.
                  </p>
                  {hasConnectedAccount && (
                    <Suggestions>
                      {prompts.slice(0, 3).map((prompt, i) => (
                        <Suggestion
                          className="h-auto py-1 text-[11px]"
                          key={i}
                          onClick={send}
                          suggestion={prompt}
                        />
                      ))}
                    </Suggestions>
                  )}
                </div>
              )}

              <MessageList
                awaitingConfirm={awaitingConfirm}
                busy={streaming}
                comments={comments}
                erroredIds={erroredIds}
                feedback={feedback}
                lastMessageComplete={status === "ready"}
                messages={messages}
                onCommentChange={handleCommentChange}
                onDecide={resolveConfirm}
                onRate={handleRate}
                onRegenerate={handleRegenerate}
                onSendComment={handleSendComment}
                resolvedTokens={resolvedTokens}
              />

              {/* 429 raises the cap panel instead, and a 403 has already
                  returned null for the whole component — so neither ever
                  reaches this bubble. */}
              {error && !capState && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {errorBubbleText(error)}
                </div>
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          <div className="shrink-0 border-t border-border p-3">
            {capState ? (
              <div className="rounded-lg bg-secondary/40 p-3 text-center">
                <p className="text-xs text-foreground">
                  You&apos;ve used your {capState.cap} playground runs — connect
                  Claude to keep going
                </p>
                <Button
                  className="mt-2"
                  onClick={() =>
                    document
                      .getElementById("setup-wizard")
                      ?.scrollIntoView({ behavior: "smooth" })
                  }
                  size="sm"
                >
                  Connect Claude
                </Button>
              </div>
            ) : (
              // No `PromptInputBody` wrapper here, deliberately: it renders a
              // `display:contents` div, which removes the BOX but not the
              // ELEMENT, and `InputGroup` derives its entire layout from
              // direct-child `has-[>…]` selectors (`has-[>textarea]:h-auto`,
              // `has-[>[data-align=block-end]]:flex-col`). Behind a wrapper
              // none of them match and the composer collapses to a 32px
              // horizontal row with the textarea and toolbar side by side.
              <PromptInput onSubmit={(message) => send(message.text ?? "")}>
                <PromptInputTextarea
                  className="min-h-10 text-xs"
                  disabled={streaming || !hasConnectedAccount || awaitingConfirm}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={placeholder}
                  value={input}
                />
                <PromptInputFooter>
                  <PromptInputTools />
                  {/* While streaming this control becomes Stop, so it must
                      stay enabled; the send-time guards apply otherwise. */}
                  <PromptInputSubmit
                    disabled={
                      !streaming &&
                      (!hasConnectedAccount || awaitingConfirm || !input.trim())
                    }
                    onStop={stop}
                    status={status}
                  />
                </PromptInputFooter>
              </PromptInput>
            )}
          </div>
        </div>
      </div>
    );
  }
);
