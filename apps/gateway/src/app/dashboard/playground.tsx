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
import { AgentMeter, type AgentQuota } from "./agent-meter";
import type { ConnectedAccount } from "./connections/types";
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
import Link from "next/link";
import { ConnectPart, ConnectReturnContext } from "./agent-parts";
import { SERVICES } from "./connections/services";
import { buttonVariants } from "@/components/ui/button";
import {
  AGENT_CAP_BODY,
  AGENT_CAP_PRIMARY_ACTION,
  AGENT_CAP_PRIMARY_HREF,
  AGENT_CAP_SECONDARY_ACTION,
  AGENT_CAP_SECONDARY_HREF,
  agentCapTitle,
} from "./agent-cap-copy";
import {
  COMPOSER_PLACEHOLDER_AWAITING_CONFIRM,
  COMPOSER_PLACEHOLDER_READY,
  PANEL_HEADING,
  PANEL_STANDFIRST,
} from "./agent-composer-copy";
import {
  RUNS_CAP_HEADER,
  RUNS_REMAINING_HEADER,
  THREAD_ID_HEADER,
} from "@/gateway/playground/quota-headers";
import {
  errorBubbleText,
  GENERIC_ERROR,
  hasPendingApproval,
  MessageList,
  messageText,
  type FeedbackState,
  type MessageTextSize,
  type PlaygroundMessage,
} from "./playground-presentation";
import { cn } from "@/lib/utils";

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

/* -------------------------------------------------------------------------- */
/* Layout                                                                      */
/* -------------------------------------------------------------------------- */

/** The two shapes this chat takes.
 *
 * `panel` is the dashboard widget: a bordered box with a heading, one block in
 * a scrolling document, sized by a max-height.
 *
 * `page` is the Agent route, where the chat IS the page — full viewport
 * height, a centred thread column, and a composer anchored to the bottom that
 * never scrolls away. There is no heading in this variant on purpose: the
 * greeting lives in the empty state, so the page does not stack a title, a
 * standfirst and an opening line on top of each other.
 *
 * ONLY presentation differs. Both variants run the same `useChat`, the same
 * send path, the same suggestions read and the same metering, because the
 * container below is shared and none of it is branched on. */
export type PlaygroundLayout = "panel" | "page";

const LAYOUT: Record<
  PlaygroundLayout,
  {
    root: string;
    /** Wraps the scrolling thread's content — this is where the centred
     * measure comes from in the page variant. */
    content: string;
    /** Extra classes applied to that content only while the thread is empty,
     * so the greeting sits in the middle of the viewport rather than pinned
     * under the top edge. */
    contentEmpty: string;
    /** The composer row. In the page variant this also carries the centring,
     * on the same measure as the thread, so the two line up. */
    footer: string;
    textarea: string;
    body: MessageTextSize;
  }
> = {
  panel: {
    // Grid, not flex, on purpose: this panel has only a max-height (it grows
    // with content up to the cap), never an explicit height. A flex column's
    // `flex-1` child never gets a *definite* height out of that —
    // `height:100%` on `use-stick-to-bottom`'s inner scroller (rendered by
    // <Conversation>) falls back to content height, so it never scrolls and
    // the outer `overflow-y-hidden` silently clips (verified live: inner grew
    // to 1131px inside a 429px box). CSS Grid's row-sizing algorithm gives the
    // `minmax(0,1fr)` row a genuinely definite size even when the grid
    // container's own height is intrinsic, so the log row — and therefore the
    // inner scroller's `height:100%` — resolves correctly once content exceeds
    // the cap, while still shrinking to content (down to min-height) for short
    // conversations. Verified in a standalone harness reproducing this exact
    // class structure (see conversation-scroll-fix.md).
    root: "relative mt-3 grid max-h-[34rem] min-h-[12rem] grid-rows-[minmax(0,1fr)_auto] rounded-xl border border-border",
    content: "gap-0 p-4",
    contentEmpty: "",
    footer: "shrink-0 border-t border-border p-3",
    textarea: "min-h-10 text-xs",
    body: "xs",
  },
  page: {
    // Same grid for the same reason, with a definite `h-full` instead of a
    // cap. Do not "simplify" this to a flex column: the height that
    // `use-stick-to-bottom` needs comes from the row track.
    root: "relative grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] bg-background",
    content: "mx-auto w-full max-w-3xl gap-0 px-4 pt-8 pb-6 sm:px-6",
    contentEmpty: "min-h-full justify-center",
    footer: "mx-auto w-full max-w-3xl shrink-0 px-4 pb-4 pt-2 sm:px-6",
    textarea: "min-h-14 text-sm",
    body: "sm",
  },
};

/** The greeting that opens an empty full-page thread.
 *
 * This is the standfirst that used to sit above the chat as page copy. It is
 * the same sentence, moved rather than rewritten — the redesign removes the
 * stacked heading, it does not make a new claim. */
const PAGE_GREETING =
  "Ask for something and it works across your connected accounts.";

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
  /** The connected accounts themselves, for the meter's connector half.
   * PASSED DOWN, NOT FETCHED HERE (SCRUM-122): this component's only caller
   * already runs `useConnections`, and a second instance in here issued a
   * second /api/connections request on every agent-page load, both counting
   * against the same rate limiter. One hook instance, one fetch, and the
   * meter cannot disagree with the surface hosting it. */
  accounts: ConnectedAccount[];
  /** Whether the connection lookup has RESOLVED. Before it has,
   * `hasConnectedAccount` is a default, not a fact (SCRUM-114): the shared
   * hook starts every user at "nothing connected" and finds out
   * asynchronously, so branching on the boolean alone told every connected
   * user they were not connected for one fetch round trip per load. The
   * empty state renders NEITHER branch until this is true. The COMPOSER is
   * deliberately not gated on it, which is a different decision made where
   * the composer is rendered: a page with nothing to type in is
   * indistinguishable from a broken one. */
  connectionsLoaded: boolean;
  /** Which shape to render. Defaults to the embedded dashboard widget, so an
   * existing caller keeps exactly what it had. */
  layout?: PlaygroundLayout;
  /** The stored conversation this chat is continuing, or null for a new one.
   *
   * PASSED WITH `initialMessages` OR NOT AT ALL. Naming a thread without
   * loading its history gives the user an empty transcript that the assistant
   * nonetheless remembers: context they cannot see, edit or clear, re-sent and
   * re-billed on every turn. The caller keys this component on the thread so
   * the two always change together. */
  threadId?: string | null;
  /** History for `threadId`, already converted to what the renderer expects. */
  initialMessages?: PlaygroundMessage[];
  /** Fired once a turn has gone out, so a thread list can pick up a new
   * conversation and its freshly written title. */
  onConversationChanged?: () => void;
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
  function Playground(
    {
      prompts,
      hasConnectedAccount,
      accounts,
      connectionsLoaded,
      loadSuggestions,
      layout = "panel",
      threadId = null,
      initialMessages,
      onConversationChanged,
    },
    ref
  ) {
    const style = LAYOUT[layout];
    const isPage = layout === "page";
    const [input, setInput] = useState("");
    const [capState, setCapState] = useState<{ cap: number } | null>(null);
    /** The meter's view of the run allowance (SCRUM-94). Seeded and refreshed
     * from /api/playground/quota, nudged instantly by the per-turn quota
     * headers when they arrive. `cap: null` is the exempt state, rendered in
     * its own words by the meter. */
    const [quota, setQuota] = useState<AgentQuota | null>(null);
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
    /** The stored thread this conversation lives in, as the server named it
     * on the last turn's response (SCRUM-78). Starts as the resumed thread's
     * id; a NEW conversation learns it from the first response, because the
     * server derives it and the client cannot. It feeds ONLY the connect
     * control's return path — it must never feed the component key or the
     * transport, which stay on the `threadId` prop so the conversation does
     * not remount mid-stream. */
    const [serverThreadId, setServerThreadId] = useState<string | null>(
      threadId
    );

    /** The user's own files when the read found any, the generic examples
     * otherwise. Derived once so the copy and the list cannot disagree about
     * which of the two is on screen.
     *
     * TOPPED UP TO THREE (SCRUM-114). The render below promises three
     * suggestions and the personalised read guarantees no count at all: it
     * returns whatever it found, and a one-file account collapsed the row to
     * a single stale-looking entry. The personalised prompts lead and the
     * generic list fills the remainder, so the promised three is enforced
     * here rather than asserted in a comment. */
    const personalised = ownFilePrompts.length > 0;
    const suggestions = personalised
      ? [
          ...ownFilePrompts,
          ...prompts.filter((p) => !ownFilePrompts.includes(p)),
        ]
      : prompts;

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
            // Same headers feed the meter, instantly. Absent headers (an
            // approval leg, or an exempt account that never gets them) leave
            // the meter alone; the status-settled refetch below covers those.
            if (remaining !== null && cap !== null) {
              const capN = Number(cap);
              const remainingN = Number(remaining);
              if (Number.isFinite(capN) && Number.isFinite(remainingN)) {
                setQuota({
                  used: Math.max(0, capN - remainingN),
                  cap: capN,
                  remaining: remainingN,
                });
              }
            }
            // Headers are available the moment the response starts, so the
            // thread is known before the connect control could ever stream in.
            const turnThread = res.headers.get(THREAD_ID_HEADER);
            if (turnThread) setServerThreadId(turnThread);
            return res;
          },
          // A resumed conversation names the thread it belongs to, so the
          // turn lands in the thread the user is looking at instead of
          // forking a new one. A new conversation sends nothing here and the
          // server derives the id from the session user, which keeps
          // ownership by construction for anything being created.
          //
          // Still one request shape otherwise: a decision on a gated write is
          // the same messages array with one tool part moved to
          // `approval-responded`, which the transport sends by default and the
          // route recognises on arrival.
          //
          // THE RETURNED `body` IS THE WHOLE REQUEST BODY, not a patch. The
          // `body` argument is only the transport's extra-body option, so the
          // default fields (`id`, `messages`, `trigger`, `messageId`) must be
          // restated here or they are silently dropped. An earlier version
          // spread them into the returned CONFIG instead of the body, which
          // sent `{threadId}` alone and 400'd every message posted into a
          // resumed thread — the exact turn the connect round trip ends on.
          prepareSendMessagesRequest: threadId
            ? ({ id, messages, trigger, messageId, body }) => ({
                body: { id, messages, trigger, messageId, ...body, threadId },
              })
            : undefined,
        }),
      [threadId]
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
      // Seeded with the stored conversation when resuming. The caller keys
      // this component on the thread, so a switch remounts rather than
      // merging two conversations into one list.
      ...(initialMessages && initialMessages.length > 0
        ? { messages: initialMessages }
        : {}),
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

    // Meter refresh, keyed on the stream settling: fires on mount (status
    // starts settled) and again after every turn, which is what keeps the
    // exempt account honest — its turns carry no quota headers, but each one
    // still counts a run, and only a re-read shows it. Errors leave the last
    // known state on screen rather than blanking a working meter.
    useEffect(() => {
      if (streaming) return;
      let cancelled = false;
      void (async () => {
        try {
          const res = await fetch("/api/playground/quota");
          if (!res.ok || cancelled) return;
          const data = (await res.json()) as {
            runsUsed?: number;
            runsCap?: number | null;
            runsRemaining?: number | null;
          };
          if (typeof data.runsUsed !== "number") return;
          setQuota({
            used: data.runsUsed,
            cap: typeof data.runsCap === "number" ? data.runsCap : null,
            remaining:
              typeof data.runsRemaining === "number" ? data.runsRemaining : null,
          });
        } catch {
          // Best-effort meter: a failed read keeps the previous state.
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [streaming]);

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
          // A turn has gone out, so a thread list is now stale: a brand new
          // conversation did not exist before this and a resumed one just
          // moved to the top. Fired after the send rather than before, so a
          // refused turn does not put a phantom row in the list.
          onConversationChanged?.();
        });
      },
      [
        streaming,
        capState,
        hidden,
        awaitingConfirm,
        runExclusive,
        sendMessage,
        onConversationChanged,
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

    /** Where a connect started from this conversation should land on return.
     * With a known thread: back into that exact conversation, which the
     * agent-client resumes and continues. Before the first turn names one
     * (the empty state): the Agent page itself, so connecting still ends in
     * the agent rather than on the connections page. Memoized so the context
     * does not re-render every message row per streamed token. */
    const connectReturn = useMemo(
      () => ({
        nextPath: serverThreadId
          ? `/dashboard/agent?thread=${encodeURIComponent(serverThreadId)}`
          : "/dashboard/agent",
      }),
      [serverThreadId]
    );

    // 403 playground_disabled — hide the section entirely rather than show a
    // dead chat box.
    if (hidden) return null;

    // The placeholder tracks the composer's ACTUAL enablement and nothing
    // else. `disabled` below is `streaming || awaitingConfirm`; connection
    // state is not in it, so it must not be in the placeholder either — an
    // unconnected user is invited to ask, and the agent handles the missing
    // connection in its reply (SCRUM-78, SCRUM-98).
    const placeholder = awaitingConfirm
      ? COMPOSER_PLACEHOLDER_AWAITING_CONFIRM
      : COMPOSER_PLACEHOLDER_READY;

    const chat = (
      <ConnectReturnContext.Provider value={connectReturn}>
      <div className={style.root}>
          <Conversation className="min-h-0">
            {/* gap-0: the message rows carry their own vertical rhythm now
                (see MessageRow), so the container must not add to it. */}
            <ConversationContent
              className={cn(
                style.content,
                messages.length === 0 && style.contentEmpty
              )}
            >
              {messages.length === 0 && (
                // The agent opens the thread rather than waiting to be
                // addressed: what it does, why it needs access, and the way to
                // grant it, all in the conversation. The connect control is
                // IN here rather than on a card above, because sending someone
                // out of the thread to come back to it is the shape that made
                // setup feel like a cliff.
                <div className={isPage ? "space-y-5" : "space-y-2"}>
                  {/* The page variant's greeting. It replaces the page title
                      and standfirst rather than adding a third line: in this
                      idiom the empty thread IS the heading, and it goes away
                      the moment there is a conversation to read instead. */}
                  {isPage && (
                    <h1 className="font-display text-xl font-bold text-foreground sm:text-2xl">
                      {PAGE_GREETING}
                    </h1>
                  )}
                  {/* CLAIMS are gated, PROMPTS are not (SCRUM-114, SCRUM-117).
                      Until the connection lookup resolves, connection state
                      is unknown and unknown makes no claim: neither the
                      connection-state copy nor the connect card renders,
                      because the card is click-instrumented and a flash
                      would log connect intent from an already-connected
                      user. The PROMPTS below are outside that gate on
                      purpose - they depend on nothing about the user's
                      connections, and what is possible should be visible
                      before anything resolves. An unconnected user who runs
                      one lands exactly in the in-thread connect flow, which
                      is the flow the product wants them in. */}
                  {connectionsLoaded && (
                    <p
                      className={cn(
                        "text-muted-foreground",
                        isPage ? "text-sm" : "text-xs"
                      )}
                    >
                      {hasConnectedAccount
                        ? personalised
                          ? suggestions.slice(0, 3).length === 1
                            ? "Here is something I can do with what you have connected."
                            : "Here are a few things I can do with what you have connected."
                          : "Ask something about your connected accounts."
                        : "I can work with your email, files, calendar and issues, once you connect an account. You can ask me anything in the meantime."}
                    </p>
                  )}
                  {/* Three suggestions, enforced by the top-up above, two
                      arrangements. The panel keeps its pill row. The page
                      stacks them full-width, because these are whole
                      sentences and a nowrap pill scroller hides most of
                      every one of them on the surface where they are the
                      main thing to read. */}
                  {isPage ? (
                        <div className="space-y-2">
                          {suggestions.slice(0, 3).map((prompt, i) => (
                            <Suggestion
                              className="h-auto w-full justify-start whitespace-normal rounded-xl px-4 py-3 text-left text-sm font-normal"
                              key={i}
                              onClick={send}
                              suggestion={prompt}
                            />
                          ))}
                        </div>
                      ) : (
                        <Suggestions>
                          {suggestions.slice(0, 3).map((prompt, i) => (
                            <Suggestion
                              className="h-auto py-1 text-[11px]"
                              key={i}
                              onClick={send}
                              suggestion={prompt}
                            />
                          ))}
                        </Suggestions>
                      )}
                  {/* The connect card: only once the state is KNOWN to be
                      unconnected, below the prompts so what is possible
                      reads before what is asked for. The card itself - copy,
                      hrefs, source property - is byte-identical to what
                      SCRUM-112 instrumented; this change moves WHERE it
                      sits, never what it is, so the telemetry series stays
                      comparable across the deploy boundary. */}
                  {connectionsLoaded && !hasConnectedAccount && (
                    <ConnectPart
                      services={CONNECTABLE_SERVICES}
                      source="empty_state"
                    />
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
                textSize={style.body}
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

          <div className={style.footer}>
            {capState ? (
              <div className="rounded-lg bg-secondary/40 p-3 text-center">
                <p className="text-xs font-medium text-foreground">
                  {agentCapTitle(capState.cap)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {AGENT_CAP_BODY}
                </p>
                <div className="mt-2 flex items-center justify-center gap-2">
                  {/* Both exits are links now. The config exit used to scroll
                      to `#setup-wizard`, an id that existed only on the old
                      /dashboard page (and exists nowhere since the wizard
                      retired), so on the Agent route the primary control did
                      nothing at the moment the user had just been refused.
                      `next/link` is correct for both: these are Next pages,
                      unlike the `/auth/*` connect controls, which are Express
                      routes and must stay plain anchors. */}
                  <Link
                    href={AGENT_CAP_PRIMARY_HREF}
                    className={buttonVariants({ size: "sm" })}
                  >
                    {AGENT_CAP_PRIMARY_ACTION}
                  </Link>
                  <Link
                    href={AGENT_CAP_SECONDARY_HREF}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    {AGENT_CAP_SECONDARY_ACTION}
                  </Link>
                </div>
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
                  className={style.textarea}
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
            {/* One glanceable line under the composer (SCRUM-94): a few px of
                footer height, so the thread flexes and the composer stays
                pinned exactly where it was. */}
            <AgentMeter
              quota={quota}
              accounts={accounts}
              accountsLoaded={connectionsLoaded}
            />
          </div>
      </div>
      </ConnectReturnContext.Provider>
    );

    // The page variant returns the chat and nothing else: no heading, no
    // wrapper, no page chrome. The dashboard widget keeps its section
    // heading, because there it really is one block among several and needs
    // to say which one it is.
    if (isPage) return chat;

    return (
      <div className="mt-8">
        <h2 className="font-display text-base font-bold text-foreground">
          {PANEL_HEADING}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {PANEL_STANDFIRST}
        </p>
        {chat}
      </div>
    );
  }
);
