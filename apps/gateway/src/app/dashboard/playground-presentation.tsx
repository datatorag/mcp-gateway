/** Presentation layer for the playground chat: plain-data components with no
 * dependency on `useChat` or any chat runtime. Everything here renders from
 * a `PlaygroundMessage[]` (or a single message) plus callbacks, so the same
 * components can later be driven by a canned script (a planned
 * marketing/ads demo) with zero chat runtime behind them.
 *
 * ZERO runtime imports from `ai` or `@ai-sdk/react` — only type-only ones,
 * which are erased at build time. `playground.tsx` (the container, which DOES
 * import `useChat`/`DefaultChatTransport`) composes these. */

import { memo } from "react";
import type { DynamicToolUIPart, UIMessage } from "ai";
import { RefreshCcwIcon, ThumbsDownIcon, ThumbsUpIcon } from "lucide-react";

import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
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
// Value import (not `import type`) — the string is compared at runtime. The
// module is dependency-free (a console.error and two exports), so pulling it
// into the client bundle costs nothing and drags in no server-only API.
import { GENERIC_ERROR_MESSAGE as SERVER_GENERIC_ERROR } from "@/lib/errors";

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

export type FeedbackState = "idle" | "down-pending" | "sending" | "thanks";

/** The playground's canonical "no useful detail" copy. Also the message the
 * transport throws for transport-level failures, so that the bubble can render
 * `error.message` verbatim (preserving the route's own actionable wording)
 * without ever exposing an internal sentinel. */
export const GENERIC_ERROR = "Something went wrong. Please try again.";

/** Resolve the error-bubble text.
 *
 * A stream `error` chunk reaches us as `new Error(chunk.errorText)`, so
 * `error.message` is whatever the route wrote. Two kinds arrive:
 *
 *  - Actionable, server-authored copy — today that's the expired-resume-token
 *    notice ("This confirmation expired — please run the prompt again."),
 *    which tells the user exactly what to do and must survive verbatim.
 *  - `logAndGenericError`'s placeholder, which carries no more information
 *    than our own copy but is worded differently. Showing it would mean the
 *    product has two different "generic error" strings depending on whether
 *    the failure happened before or during the stream.
 *
 * So: pass actionable text through, and normalise everything else — client- or
 * server-generated — to `GENERIC_ERROR`.
 *
 * Exported for `playground.test.ts`, which is the only assertion anywhere on
 * this product's user-facing copy — it exists because this exact defect
 * (two "generic" strings silently diverging) shipped twice, invisible to
 * tsc/build/tests both times. */
export function errorBubbleText(error: Error | undefined): string {
  const serverMessage = error?.message?.trim();
  return !serverMessage || serverMessage === SERVER_GENERIC_ERROR
    ? GENERIC_ERROR
    : serverMessage;
}

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                                */
/* -------------------------------------------------------------------------- */

/** MCP tool names arrive namespaced as `<slug>__<tool>`; only the tail is
 * meaningful to a user reading a confirmation card or a tool chip. */
export function shortToolName(name: string): string {
  return name.split("__").pop() || name;
}

/** Compact one-line summary of a pending write's arguments, shown on the
 * confirmation card so the user sees what will actually run before approving. */
export function summarizeArgs(input: Record<string, unknown>): string {
  const s = JSON.stringify(input ?? {});
  return s.length > 160 ? `${s.slice(0, 159)}…` : s;
}

export function messageText(message: PlaygroundMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
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

export interface ConfirmCardProps {
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

export function WriteOutcomes({ outcomes }: { outcomes: WriteOutcome[] }) {
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

export interface FeedbackControlsProps {
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

interface MessageRowProps {
  message: PlaygroundMessage;
  /** Whether this is the last message in the list — gates the Regenerate
   * action, which only ever applies to the most recent turn. */
  isLast: boolean;
  /** Whether to show the actions row (regenerate/feedback) under this
   * message at all — computed by the caller from completeness + error state,
   * since those are list-wide concerns this row doesn't need to know about. */
  showActions: boolean;
  /** Client-local approve/deny decisions, keyed by resume token. */
  resolvedTokens: ReadonlyMap<string, Decision>;
  /** A request is in flight — confirm buttons and regenerate are locked. */
  busy: boolean;
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

/** One row of the message list, memoized so a streamed token only re-renders
 * the message it belongs to. `useChat` deliberately keeps non-streaming
 * `messages` entries referentially identical (`replaceMessage` preserves
 * `slice(0,i)`/`slice(i+1)`), so as long as every prop here is stable when
 * its value hasn't changed, `memo` bails on the other N-1 rows per token
 * instead of re-rendering the whole list. */
export const MessageRow = memo(function MessageRow({
  message,
  isLast,
  showActions,
  resolvedTokens,
  busy,
  awaitingConfirm,
  onDecide,
  onRegenerate,
  feedback,
  comments,
  onRate,
  onCommentChange,
  onSendComment,
}: MessageRowProps) {
  return (
    <Message from={message.role}>
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
});

export interface MessageListProps {
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

export function MessageList({
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
          <MessageRow
            awaitingConfirm={awaitingConfirm}
            busy={busy}
            comments={comments}
            feedback={feedback}
            isLast={isLast}
            key={message.id}
            message={message}
            onCommentChange={onCommentChange}
            onDecide={onDecide}
            onRate={onRate}
            onRegenerate={onRegenerate}
            onSendComment={onSendComment}
            resolvedTokens={resolvedTokens}
            showActions={showActions}
          />
        );
      })}
    </>
  );
}
