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
import { DefaultChatTransport, type DynamicToolUIPart, type UIMessage } from "ai";
import { RefreshCcwIcon, ThumbsDownIcon, ThumbsUpIcon } from "lucide-react";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Decision, PendingWrite } from "@/gateway/playground/engine";

/* -------------------------------------------------------------------------- */
/* Wire types                                                                  */
/* -------------------------------------------------------------------------- */

/** One entry of the route's `data-write-outcome` payload. Mirrors
 * `executeWriteBatch`'s return shape in the engine (which types it inline, so
 * there is nothing importable). NOTE: `denied` conflates "the user denied this
 * write" with "the batch was aborted before this write ran" — the server cannot
 * tell them apart downstream, so the UI must not invent a distinction. */
export type WriteOutcome = { name: string; isError: boolean; denied: boolean };

/** Custom stream parts the playground route writes alongside the standard
 * text/tool parts. Keys become `data-<key>` part types. */
type PlaygroundDataParts = {
  confirm: { resumeToken: string; pending: PendingWrite[] };
  "write-outcome": { outcomes: WriteOutcome[] };
};

/** The message shape flowing through `useChat` — and, equally, the shape the
 * presentation components below accept. Anything that can produce a
 * `PlaygroundMessage[]` (a live chat, a canned script) can drive the UI. */
export type PlaygroundMessage = UIMessage<unknown, PlaygroundDataParts>;

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

type FeedbackState = "idle" | "down-pending" | "sending" | "thanks";

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                                */
/* -------------------------------------------------------------------------- */

/** MCP tool names arrive namespaced as `<slug>__<tool>`; only the tail is
 * meaningful to a user reading a confirmation card or a tool chip. */
function shortToolName(name: string): string {
  return name.split("__").pop() || name;
}

/** Compact one-line summary of a pending write's arguments, shown on the
 * confirmation card so the user sees what will actually run before approving. */
function summarizeArgs(input: Record<string, unknown>): string {
  const s = JSON.stringify(input ?? {});
  return s.length > 160 ? `${s.slice(0, 159)}…` : s;
}

function messageText(message: PlaygroundMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
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
/* Presentation layer                                                          */
/*                                                                             */
/* Everything below renders from plain UIMessage-shaped data plus callbacks.   */
/* None of it touches useChat — the same components can later be driven by a   */
/* canned script (marketing demo) with no chat runtime behind them.            */
/* -------------------------------------------------------------------------- */

function ToolCard({ part }: { part: DynamicToolUIPart }) {
  return (
    <Tool className="mb-0 text-xs">
      <ToolHeader
        state={part.state}
        toolName={shortToolName(part.toolName)}
        type="dynamic-tool"
      />
      <ToolContent>
        <ToolInput input={part.input ?? {}} />
        <ToolOutput errorText={part.errorText} output={part.output} />
      </ToolContent>
    </Tool>
  );
}

interface ConfirmCardProps {
  resumeToken: string;
  pending: PendingWrite[];
  /** Client-local resolution for this token, if the user already decided.
   * The server never rewrites the original `data-confirm` part. */
  resolution: Decision | undefined;
  /** Approve/Deny are locked while a request is in flight. */
  disabled: boolean;
  onDecide: (
    resumeToken: string,
    pending: PendingWrite[],
    decision: Decision
  ) => void;
}

function ConfirmCard({
  resumeToken,
  pending,
  resolution,
  disabled,
  onDecide,
}: ConfirmCardProps) {
  if (resolution) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Action {resolution === "approve" ? "approved" : "denied"}
      </p>
    );
  }

  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs">
      <p className="font-medium text-amber-900">
        Approve this action before it runs?
      </p>
      <ul className="mt-1.5 space-y-1">
        {pending.map((write) => (
          <li key={write.id} className="text-amber-800">
            <span className="font-mono font-medium">
              {shortToolName(write.name)}
            </span>
            <span className="break-all text-amber-700">
              {" · "}
              {summarizeArgs(write.input)}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <Button
          disabled={disabled}
          onClick={() => onDecide(resumeToken, pending, "approve")}
          size="xs"
        >
          Approve &amp; run
        </Button>
        <Button
          className="border-amber-300 bg-transparent text-amber-900 hover:bg-amber-100"
          disabled={disabled}
          onClick={() => onDecide(resumeToken, pending, "deny")}
          size="xs"
          variant="outline"
        >
          Deny
        </Button>
      </div>
    </div>
  );
}

function WriteOutcomes({ outcomes }: { outcomes: WriteOutcome[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {outcomes.map((outcome, i) => (
        <span className="flex items-center gap-1" key={i}>
          <Badge variant={outcome.isError ? "destructive" : "success"}>
            {shortToolName(outcome.name)}
          </Badge>
          {outcome.denied && <Badge variant="secondary">denied</Badge>}
        </span>
      ))}
    </div>
  );
}

interface FeedbackControlsProps {
  messageId: string;
  state: FeedbackState;
  comment: string;
  onRate: (messageId: string, rating: "up" | "down") => void;
  onCommentChange: (messageId: string, comment: string) => void;
  onSendComment: (messageId: string) => void;
}

function FeedbackControls({
  messageId,
  state,
  comment,
  onRate,
  onCommentChange,
  onSendComment,
}: FeedbackControlsProps) {
  if (state === "thanks") {
    return (
      <span className="text-[11px] text-muted-foreground">
        Thanks for the feedback
      </span>
    );
  }

  return (
    <>
      <MessageAction
        disabled={state === "sending"}
        label="Good response"
        onClick={() => onRate(messageId, "up")}
        tooltip="Good response"
      >
        <ThumbsUpIcon className="size-3.5" />
      </MessageAction>
      <MessageAction
        disabled={state === "sending"}
        label="Bad response"
        onClick={() => onRate(messageId, "down")}
        tooltip="Bad response"
      >
        <ThumbsDownIcon className="size-3.5" />
      </MessageAction>
      {state === "down-pending" && (
        <span className="flex items-center gap-1.5">
          <Input
            className="h-7 w-56 text-[11px]"
            onChange={(e) => onCommentChange(messageId, e.target.value)}
            placeholder="What went wrong? (optional)"
            value={comment}
          />
          <Button onClick={() => onSendComment(messageId)} size="xs" variant="outline">
            Send
          </Button>
        </span>
      )}
    </>
  );
}

interface MessageListProps {
  messages: PlaygroundMessage[];
  /** Client-local approve/deny decisions, keyed by resume token. */
  resolvedTokens: ReadonlyMap<string, Decision>;
  /** A request is in flight — confirm buttons and regenerate are locked. */
  busy: boolean;
  /** Whether the final message in the list has finished streaming. Earlier
   * messages are complete by construction. */
  lastMessageComplete: boolean;
  /** Assistant messages whose turn ended in an error; they get no feedback UI. */
  erroredIds: ReadonlySet<string>;
  /** True while an unresolved confirm gates the conversation. */
  awaitingConfirm: boolean;
  onDecide: ConfirmCardProps["onDecide"];
  onRegenerate: () => void;
  feedback: Record<string, FeedbackState>;
  comments: Record<string, string>;
  onRate: FeedbackControlsProps["onRate"];
  onCommentChange: FeedbackControlsProps["onCommentChange"];
  onSendComment: FeedbackControlsProps["onSendComment"];
}

function MessageList({
  messages,
  resolvedTokens,
  busy,
  lastMessageComplete,
  erroredIds,
  awaitingConfirm,
  onDecide,
  onRegenerate,
  feedback,
  comments,
  onRate,
  onCommentChange,
  onSendComment,
}: MessageListProps) {
  return (
    <>
      {messages.map((message, index) => {
        const isLast = index === messages.length - 1;
        const complete = !isLast || lastMessageComplete;
        const showActions =
          message.role === "assistant" && complete && !erroredIds.has(message.id);

        return (
          <Message from={message.role} key={message.id}>
            <MessageContent className="text-xs">
              {message.parts.map((part, partIndex) => {
                const key = `${message.id}-${partIndex}`;
                if (part.type === "text") {
                  return (
                    <MessageResponse className="text-xs" key={key}>
                      {part.text}
                    </MessageResponse>
                  );
                }
                if (part.type === "dynamic-tool") {
                  return <ToolCard key={key} part={part} />;
                }
                if (part.type === "data-confirm") {
                  return (
                    <ConfirmCard
                      disabled={busy}
                      key={key}
                      onDecide={onDecide}
                      pending={part.data.pending}
                      resolution={resolvedTokens.get(part.data.resumeToken)}
                      resumeToken={part.data.resumeToken}
                    />
                  );
                }
                if (part.type === "data-write-outcome") {
                  return <WriteOutcomes key={key} outcomes={part.data.outcomes} />;
                }
                return null;
              })}
            </MessageContent>

            {showActions && (
              <MessageActions>
                {isLast && (
                  <MessageAction
                    disabled={awaitingConfirm || busy}
                    label="Regenerate"
                    onClick={onRegenerate}
                    tooltip="Regenerate"
                  >
                    <RefreshCcwIcon className="size-3.5" />
                  </MessageAction>
                )}
                <FeedbackControls
                  comment={comments[message.id] ?? ""}
                  messageId={message.id}
                  onCommentChange={onCommentChange}
                  onRate={onRate}
                  onSendComment={onSendComment}
                  state={feedback[message.id] ?? "idle"}
                />
              </MessageActions>
            )}
          </Message>
        );
      })}
    </>
  );
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
            const res = await fetch(url, init);
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
            // 400 / 500 (and anything else non-2xx) land in the chat error state.
            if (!res.ok) throw new Error("request_failed");
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
          capState ||
          hidden ||
          !hasConnectedAccount ||
          awaitingConfirm
        ) {
          return;
        }
        setInput("");
        void runExclusive(() => sendMessage({ text }));
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
        if (streaming) return;
        setResolvedTokens((prev) => new Map(prev).set(resumeToken, decision));
        // `Object.fromEntries` (not `obj[key] = …`) so a hostile write id such
        // as "__proto__" becomes an own property instead of mutating a prototype.
        const decisions = Object.fromEntries(
          pending.map((write) => [write.id, decision])
        );
        void runExclusive(() =>
          sendMessage(undefined, { body: { resumeToken, decisions } })
        );
      },
      [streaming, runExclusive, sendMessage]
    );

    useImperativeHandle(ref, () => ({ runPrompt: send }), [send]);

    const submitFeedback = useCallback(
      (messageId: string, rating: "up" | "down") => {
        const prompt = precedingUserPrompt(messages, messageId);
        const comment = comments[messageId]?.trim() || undefined;
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
      },
      [messages, comments]
    );

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

        <div className="relative mt-3 flex max-h-[34rem] min-h-[12rem] flex-col rounded-xl border border-border">
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
                      {prompts.slice(0, 3).map((prompt) => (
                        <Suggestion
                          className="h-auto py-1 text-[11px]"
                          key={prompt}
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

              {error && !capState && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  Something went wrong. Please try again.
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
              <PromptInput onSubmit={(message) => send(message.text ?? "")}>
                <PromptInputBody>
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
                </PromptInputBody>
              </PromptInput>
            )}
          </div>
        </div>
      </div>
    );
  }
);
