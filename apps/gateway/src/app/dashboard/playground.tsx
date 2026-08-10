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
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";

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
import { ConnectPart } from "./agent-parts";
import { SERVICES } from "./connections/services";
import { Button } from "@/components/ui/button";
import { RUNS_CAP_HEADER, RUNS_REMAINING_HEADER } from "@/gateway/playground/quota-headers";
import {
  errorBubbleText,
  GENERIC_ERROR,
  hasPendingApproval,
  MessageList,
  messageText,
  type FeedbackState,
  type PlaygroundMessage,
} from "./playground-presentation";

/** Thrown by the transport for a 429, and never shown: the cap panel replaces
 * the composer instead, so rendering this sentinel would put an internal
 * string in front of the user. */
const CAP_EXCEEDED = "cap_exceeded";

/** The connectable services, in the shape the connect control takes. Derived
 * from the one SERVICES list rather than restated, so a new connector appears
 * in the thread without anyone remembering to add it here. */
const CONNECTABLE_SERVICES = SERVICES.map((service) => ({
  id: service.id,
  name: service.name,
  connectHref: service.connectUrl,
}));

export interface PlaygroundHandle {
  /** Seed the input with `prompt` and submit it immediately. Used by the
   * "What can I do?" prompt cards' Run action in dashboard-client.tsx. */
  runPrompt: (prompt: string) => void;
}

interface PlaygroundProps {
  /** Example prompts, offered as quick-start chips in the empty state. */
  prompts: string[];
  /** Fetch three actions named from the user's real files. Injected rather
   * than called directly so the presentation stays drivable by canned data. */
  loadSuggestions?: () => Promise<string[]>;
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
  function Playground({ prompts, hasConnectedAccount, loadSuggestions }, ref) {
    const [input, setInput] = useState("");
    const [capState, setCapState] = useState<{ cap: number } | null>(null);
    const [hidden, setHidden] = useState(false);
    const [feedback, setFeedback] = useState<Record<string, FeedbackState>>({});
    const [comments, setComments] = useState<Record<string, string>>({});
    const [erroredIds, setErroredIds] = useState<ReadonlySet<string>>(
      () => new Set()
    );
    /** Suggestions naming the user's own files. Empty until the read returns,
     * and empty forever if it returns nothing usable — a generic suggestion
     * dressed as a personal one is worse than none. */
    const [ownFilePrompts, setOwnFilePrompts] = useState<string[]>([]);

    useEffect(() => {
      if (!hasConnectedAccount || !loadSuggestions) return;
      let live = true;
      void loadSuggestions()
        .then((next) => {
          if (live) setOwnFilePrompts(next);
        })
        .catch(() => {});
      return () => {
        live = false;
      };
    }, [hasConnectedAccount, loadSuggestions]);

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
              throw new Error(CAP_EXCEEDED);
            }
            // 400 / 500 (and anything else non-2xx) land in the chat error
            // state. The thrown message IS the user-facing copy, because the
            // error bubble renders `error.message` verbatim so that the
            // route's own actionable text (e.g. the expired-resume-token
            // stream) survives — a sentinel like "request_failed" would be
            // rendered to the user as-is.
            if (!res.ok) throw new Error(GENERIC_ERROR);
            // The turn that EXHAUSTS the quota says so on its own response,
            // instead of the user discovering it by being refused next time.
            // Absent headers mean "this turn spent nothing" (an approval leg),
            // which must leave the quota state alone rather than reset it.
            const remaining = res.headers.get(RUNS_REMAINING_HEADER);
            const cap = res.headers.get(RUNS_CAP_HEADER);
            if (remaining !== null && cap !== null && Number(remaining) <= 0) {
              setCapState({ cap: Number(cap) });
            }
            return res;
          },
          // No `prepareSendMessagesRequest`: there is one request shape now.
          // A decision on a gated write is not a different kind of request —
          // it is the same messages array with one tool part moved to
          // `approval-responded`, which the transport sends by default and the
          // route recognises on arrival.
        }),
      []
    );

    const {
      messages,
      sendMessage,
      addToolApprovalResponse,
      stop,
      regenerate,
      status,
      error,
    } = useChat<PlaygroundMessage>({
      transport,
      // NO `id`, SO EVERY PAGE LOAD IS A NEW CONVERSATION — deliberate, and
      // not the same thing as conversations not being saved. The server now
      // persists every turn, keyed by the conversation id the browser sends;
      // with no `id` here the chat runtime mints a fresh one per mount, so a
      // reload starts a new thread and the previous one stays on disk,
      // complete, addressed by nobody.
      //
      // DO NOT "fix" this by pinning a stable id on its own. A stable id
      // without also loading that thread's messages back into this list gives
      // the user an empty transcript that the assistant nonetheless remembers
      // — invisible context they cannot see, edit, or clear, re-sent and
      // re-billed on every turn. Worse, a thread whose last turn stopped on an
      // approval would come back with a pending decision that is no longer
      // answerable: the suspended run is consumed on first use, and approval
      // ids do not survive a restart by design (see
      // gateway/playground/run-ownership.ts).
      // Restoring a conversation means restoring its messages and handling
      // that state, together, in one change.
      // Recording a decision has to POST it, or the suspended turn never
      // resumes. This fires that request once every gated call in the last
      // step has an answer — so a turn that paused on two writes waits for
      // both decisions and then resumes once.
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    });

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
    //
    // Read straight off the tool parts, with no client-side bookkeeping: the
    // chat runtime rewrites the part in place when the decision is recorded,
    // so "already decided" is a state of the conversation rather than
    // something this component has to remember. It is also what makes this
    // correct across a suspended stream, which closes with no `finish` part
    // and therefore gives no other signal that the turn stopped.
    const awaitingConfirm = useMemo(() => hasPendingApproval(messages), [messages]);

    const send = useCallback(
      (raw: string) => {
        const text = raw.trim();
        if (
          !text ||
          streaming ||
          busyRef.current ||
          capState ||
          hidden ||
          awaitingConfirm
        ) {
          return;
        }
        // NOT gated on having a connected account, deliberately. A user
        // without access gets an honest answer about what the agent cannot do
        // and the connect control stays in the thread. Refusing to send left
        // them typing into a dead box, which reads as broken rather than as
        // blocked.
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
        awaitingConfirm,
        runExclusive,
        sendMessage,
      ]
    );

    /** Answer one gated tool call.
     *
     * ⚠️ `approvalId` is passed through EXACTLY as it arrived. It is minted by
     * the server and carries its owner in an HMAC that is verified in constant
     * time, so any client-side rewriting — trimming, re-encoding, splitting off
     * a "cleaner" id, regenerating it — produces a 403 and leaves the user
     * unable to approve their own write. There is deliberately no
     * normalisation step here to be tempted into "fixing".
     *
     * Recording the response rewrites the tool part in place and, once every
     * gated call in the step has an answer, posts the whole conversation back
     * (see `sendAutomaticallyWhen`). `regenerate()` would be wrong here: it
     * drops the last assistant message, destroying the suspended turn. */
    const respondToApproval = useCallback(
      (approvalId: string, approved: boolean) => {
        if (streaming || busyRef.current) return;
        void runExclusive(async () => {
          await addToolApprovalResponse({ id: approvalId, approved });
        });
      },
      [streaming, runExclusive, addToolApprovalResponse]
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
          <Conversation className="min-h-0">
            {/* gap-0: the message rows carry their own vertical rhythm now
                (see MessageRow), so the container must not add to it. */}
            <ConversationContent className="gap-0 p-4">
              {messages.length === 0 && (
                // The agent opens the thread rather than waiting to be
                // addressed: what it does, why it needs access, and the way to
                // grant it, all in the conversation. The connect control is
                // IN here rather than on a card above, because sending someone
                // out of the thread to come back to it is the shape that made
                // setup feel like a cliff.
                <div className="space-y-2">
                  {hasConnectedAccount ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        {ownFilePrompts.length > 0
                          ? "Here are a few things I can do with what you just connected."
                          : "Ask something about your connected accounts."}
                      </p>
                      <Suggestions>
                        {(ownFilePrompts.length > 0
                          ? ownFilePrompts
                          : prompts
                        )
                          .slice(0, 3)
                          .map((prompt, i) => (
                            <Suggestion
                              className="h-auto py-1 text-[11px]"
                              key={i}
                              onClick={send}
                              suggestion={prompt}
                            />
                          ))}
                      </Suggestions>
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">
                        I can work with your email, files, calendar and issues,
                        once you connect an account. You can ask me anything in
                        the meantime.
                      </p>
                      <ConnectPart services={CONNECTABLE_SERVICES} />
                    </>
                  )}
                </div>
              )}

              <MessageList
                awaitingConfirm={awaitingConfirm}
                busy={streaming}
                comments={comments}
                erroredIds={erroredIds}
                feedback={feedback}
                // `ready` really does mean "the stream closed", including for
                // a turn that suspended on an approval and therefore never
                // emitted a `finish` part — the runtime sets it when the body
                // ends, not when it sees `finish`. Completeness and
                // finishedness are not the same thing here, which is why
                // `awaitingConfirm` is passed alongside.
                lastMessageComplete={status === "ready"}
                messages={messages}
                onCommentChange={handleCommentChange}
                onDecide={respondToApproval}
                onRate={handleRate}
                onRegenerate={handleRegenerate}
                onSendComment={handleSendComment}
              />

              {/* 429 raises the cap panel instead, and a 403 has already
                  returned null for the whole component — so neither ever
                  reaches this bubble. Keyed on the sentinel rather than on
                  `capState`, which is now also set by a successful turn that
                  merely spent the last run: a genuine failure after that
                  point still deserves a bubble. */}
              {error && error.message !== CAP_EXCEEDED && (
                <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
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
                  disabled={streaming || awaitingConfirm}
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
                      (awaitingConfirm || !input.trim())
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
