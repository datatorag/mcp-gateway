"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import posthog from "posthog-js";
import { EVENTS } from "@/lib/analytics";
import { Playground, type PlaygroundHandle } from "../playground";
import { AGENT_PROMPTS } from "../agent-prompts";
import { useSignupConversion } from "../use-signup-conversion";
import { useConnections } from "../use-connections";
import type { ConnectionsView } from "@/gateway/connections-view";
import { ThreadList } from "./thread-list";
import type { PlaygroundMessage } from "../playground-presentation";
import { getConnectableService } from "../connections/service-registry";
import {
  connectContinuationMessage,
  connectErrorNotice,
} from "../agent-connect-copy";

/** Which login put the user here: the post-signup landing, or a returning
 * user's. Travels as the `landed_from` property on
 * `AGENT_DEFAULT_VIEW_SHOWN`; see the event's note in `lib/analytics.ts`. */
export type AgentLandedFrom = "signup" | "login";

/**
 * The Agent, on its own route.
 *
 * It was previously the last block of a long dashboard page, reachable by
 * scrolling. Giving it a route is what lets it be a destination: something to
 * link to, to land on after login, and to come back to.
 *
 * THE CHAT IS THE PAGE. There is no title and no standfirst here on purpose —
 * the greeting is the empty state's, and a heading above it only stacked three
 * openings on top of each other. The full-height shell comes from
 * `dashboard/layout.tsx`, which drops its padded content wrapper on this
 * route; this component's job is just to fill the box it is handed.
 */
export function AgentClient({
  isDefaultView,
  landedFrom,
  resumeThreadId = null,
  connectedService = null,
  connectError = null,
  seedPrompt = null,
  initialConnections = null,
}: {
  isDefaultView: boolean;
  landedFrom: AgentLandedFrom;
  /** The connection state as the server loaded it at render time
   * (SCRUM-206), so the empty state's first paint is the right one and
   * nothing is fetched to find out. Null only when a caller has no server
   * answer, in which case the hook fetches as before. */
  initialConnections?: ConnectionsView | null;
  /** Thread to reopen on mount — the connect round trip's return leg. */
  resumeThreadId?: string | null;
  /** Registry id of the service the user just connected, when they did. */
  connectedService?: string | null;
  /** Error code from a connect that did not finish. */
  connectError?: string | null;
  /** A prompt to run on arrival, RESOLVED SERVER-SIDE from the shared list
   * by index (SCRUM-118) — the Connections page's Run action. Never raw URL
   * text: the server hands this component either a string from
   * AGENT_PROMPTS or null, so there is no payload a crafted link can carry
   * into an auto-submitted turn. */
  seedPrompt?: string | null;
}) {
  const { accounts, hasConnectedAccount, loaded: connectionsLoaded } =
    useConnections(initialConnections);
  const ref = useRef<PlaygroundHandle>(null);

  /** Run the seeded prompt exactly once, stripping the param first so a
   * reload or a shared URL cannot re-submit it (same pattern as the connect
   * return leg below and the signup conversion). The one-shot ref guards the
   * same thing within this mount. */
  const seededRef = useRef(false);
  useEffect(() => {
    if (!seedPrompt || seededRef.current) return;
    seededRef.current = true;
    const params = new URLSearchParams(window.location.search);
    params.delete("prompt");
    const rest = params.toString();
    window.history.replaceState(
      null,
      "",
      rest ? `${window.location.pathname}?${rest}` : window.location.pathname
    );
    ref.current?.runPrompt(seedPrompt);
  }, [seedPrompt]);

  // New users land HERE, so the signup conversion has to fire here too.
  useSignupConversion();

  /** Deterministic read, no model call, no run spent. Stable identity so the
   * effect that consumes it does not re-fire on every render. */
  const loadSuggestions = useCallback(async () => {
    const res = await fetch("/api/agent/suggestions");
    if (!res.ok) return [];
    const data = (await res.json()) as { suggestions?: Array<{ text: string }> };
    return (data.suggestions ?? []).map((s) => s.text);
  }, []);

  // Whether the user actually LANDED here, rather than navigating to it, is
  // what separates a "landed on Agent" cohort from everyone else in the funnel.
  // Fired once per mount, and only when the route was the destination.
  //
  // `landed_from` is what keeps the two landings apart now that BOTH a signup
  // and a plain login end up here. Without it the event silently changes
  // meaning from "a new user landed" to "anyone landed", and every existing
  // read of it keeps returning a number while answering a different question.
  // The event NAME stays put on purpose - see the note in `lib/analytics.ts`.
  useEffect(() => {
    if (isDefaultView) {
      posthog.capture(EVENTS.AGENT_DEFAULT_VIEW_SHOWN, {
        landed_from: landedFrom,
      });
    }
  }, [isDefaultView, landedFrom]);

  /* WHICH CONVERSATION IS ON SCREEN.
   *
   * `thread` is null for a new chat and a stored thread id when resuming.
   * `history` is that thread's messages, already converted server-side into
   * what the renderer expects.
   *
   * THEY MOVE TOGETHER OR NOT AT ALL. Naming a thread without loading its
   * history hands the user an empty transcript that the assistant nonetheless
   * remembers: context they cannot see, edit or clear, re-sent and re-billed
   * every turn. So both are set in one place, and the chat is KEYED on the
   * thread so a switch remounts instead of merging two conversations into one
   * list. */
  const [thread, setThread] = useState<{
    id: string | null;
    history: PlaygroundMessage[];
    /** Bumped on every new chat so the key changes even when both ids are
     * null, which is what makes "New chat" clear a conversation in progress. */
    epoch: number;
  }>({ id: null, history: [], epoch: 0 });

  /** Bumped after a turn goes out, so the list refetches and picks up a new
   * conversation and its freshly written title. */
  const [listToken, setListToken] = useState(0);
  const refreshList = useCallback(() => setListToken((n) => n + 1), []);

  const startNewChat = useCallback(() => {
    setThread((prev) => ({ id: null, history: [], epoch: prev.epoch + 1 }));
  }, []);

  const openThread = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/playground/threads/${encodeURIComponent(id)}`);
      // A thread that is not this user's, or is gone, answers the same 404.
      // Refusing to switch is the honest outcome: switching to an empty view
      // would imply the conversation exists and is simply blank.
      if (!res.ok) return;
      const data = (await res.json()) as { messages?: PlaygroundMessage[] };
      setThread((prev) => ({
        id,
        history: Array.isArray(data.messages) ? data.messages : [],
        epoch: prev.epoch + 1,
      }));
    } catch {
      // Leave the current conversation alone rather than blanking the screen.
    }
  }, []);

  /* THE CONNECT ROUND TRIP'S RETURN LEG (SCRUM-78).
   *
   * The inline Connect control sent the user to Google with
   * `next=/dashboard/agent?thread=<id>`; the OAuth callback validated that
   * path and appended `connected=<service>` (or `connect_error=<code>`). This
   * is where the loop closes: reopen the conversation the user left, and once
   * its history is on screen, post the continuation message so the agent
   * picks the original request back up. That message is VISIBLE, as the user,
   * on purpose — a hidden trigger would be context they cannot see or clear,
   * persisted into the thread forever (see agent-connect-copy.ts).
   *
   * The params are stripped from the URL immediately (same pattern as the
   * signup conversion), so a reload or a shared URL cannot re-post the
   * continuation into the thread. The one-shot ref guards the same thing
   * within this mount. */
  const continuation =
    connectedService && resumeThreadId
      ? getConnectableService(connectedService)?.name ?? null
      : null;
  const [pendingContinue, setPendingContinue] = useState<string | null>(
    continuation
  );
  useEffect(() => {
    if (!resumeThreadId && !connectedService && !connectError) return;
    const params = new URLSearchParams(window.location.search);
    params.delete("thread");
    params.delete("connected");
    params.delete("connect_error");
    const rest = params.toString();
    window.history.replaceState(
      null,
      "",
      rest ? `${window.location.pathname}?${rest}` : window.location.pathname
    );
    if (resumeThreadId) void openThread(resumeThreadId);
  }, [resumeThreadId, connectedService, connectError, openThread]);

  useEffect(() => {
    if (!pendingContinue) return;
    // Wait until the conversation the user left is actually the one on
    // screen; a continuation posted into a fresh empty thread would orphan
    // the original request in a conversation nobody is looking at.
    if (thread.id !== resumeThreadId) return;
    const handle = ref.current;
    if (!handle) return;
    setPendingContinue(null);
    handle.runPrompt(connectContinuationMessage(pendingContinue));
  }, [pendingContinue, thread.id, resumeThreadId]);

  return (
    // `h-full` so the chat inherits a definite height rather than growing past
    // it, and NOT `dvh`: the shell is only a viewport tall when nothing sits
    // above the app, and at runtime it is a measured pixel height (see
    // `useFitBelowTopChrome`). Asking for the viewport here would make this
    // taller than its own parent, which clips, and push the composer off the
    // bottom — the exact bug the measurement exists to prevent.
    //
    // `min-h-0` is defensive here rather than load-bearing, and the comment
    // that used to claim otherwise was wrong: this is a BLOCK box, since
    // `main` is `flex-1` (a flex-item property) but not itself `display:flex`,
    // and a block box's `min-height:auto` is already 0. The content-based
    // minimum that genuinely needs overriding is one level down, on the chat's
    // own root, which IS a flex item of this element.
    // A row on desktop: conversations rail beside the chat. The rail is hidden
    // on narrow viewports, where a 240px sidebar beside a chat leaves room for
    // neither; the chat itself is the surface that has to survive there.
    <div className="flex h-full min-h-0">
      <div className="hidden md:flex md:h-full md:min-h-0">
        <ThreadList
          activeId={thread.id}
          onNew={startNewChat}
          onOpen={(id) => void openThread(id)}
          refreshToken={listToken}
        />
      </div>

      <div className="flex h-full min-h-0 flex-1 flex-col">
        {connectError && (
          // The connect came back without finishing. Say so where the user
          // landed; the control they used is still in the thread below. The
          // zero-grant code (SCRUM-149) earns its own words — "didn't finish"
          // would hide that the fix is ticking the boxes on Google's screen.
          <div className="mx-4 mt-3 shrink-0 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 sm:mx-6">
            {connectErrorNotice(connectError)}
          </div>
        )}
        {/* NOT gated on `loaded`. Withholding the composer until an account
            lookup returns turns a slow or failed request into a page with
            nothing to type in, which is indistinguishable from the product
            being broken. `hasConnectedAccount` is false until we know better,
            and false is the state the empty state already handles.

            KEYED ON THE CONVERSATION. Remounting on a switch is what keeps the
            thread id and its history inseparable: React cannot hand the next
            conversation a list left over from the last one.

            The wrapper gives the chat its height as a FLEX ITEM (`flex-1
            min-h-0`) rather than `h-full`, so the error notice above can take
            its row without pushing the composer below the fold. */}
        <div className="min-h-0 flex-1">
          <Playground
            accounts={accounts}
            connectionsLoaded={connectionsLoaded}
            hasConnectedAccount={hasConnectedAccount}
            initialMessages={thread.history}
            key={`${thread.id ?? "new"}:${thread.epoch}`}
            layout="page"
            loadSuggestions={loadSuggestions}
            onConversationChanged={refreshList}
            prompts={AGENT_PROMPTS}
            ref={ref}
            threadId={thread.id}
            // The signup landing (SCRUM-206): a user who signed up seconds ago
            // cannot hold a connection, so the empty state assumes none
            // without waiting for the lookup. State only; the copy for an
            // unconnected user is the same however they arrived.
            welcome={landedFrom === "signup"}
          />
        </div>
      </div>
    </div>
  );
}
