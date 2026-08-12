"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import posthog from "posthog-js";
import { EVENTS } from "@/lib/analytics";
import { Playground, type PlaygroundHandle } from "../playground";
import { AGENT_PROMPTS } from "../agent-prompts";
import { useSignupConversion } from "../use-signup-conversion";
import { useConnections } from "../use-connections";
import { ThreadList } from "./thread-list";
import type { PlaygroundMessage } from "../playground-presentation";

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
export function AgentClient({ isDefaultView }: { isDefaultView: boolean }) {
  const { hasConnectedAccount } = useConnections();
  const ref = useRef<PlaygroundHandle>(null);

  // New users now land HERE, so the signup conversion has to fire here too.
  useSignupConversion();

  /** Deterministic read, no model call, no run spent. Stable identity so the
   * effect that consumes it does not re-fire on every render. */
  const loadSuggestions = useCallback(async () => {
    const res = await fetch("/api/agent/suggestions");
    if (!res.ok) return [];
    const data = (await res.json()) as { suggestions?: Array<{ text: string }> };
    return (data.suggestions ?? []).map((s) => s.text);
  }, []);

  // Whether a new user actually LANDED here, rather than navigating to it, is
  // what separates a "landed on Agent" cohort from everyone else in the funnel.
  // Fired once per mount, and only when the route was the destination.
  useEffect(() => {
    if (isDefaultView) posthog.capture(EVENTS.AGENT_DEFAULT_VIEW_SHOWN);
  }, [isDefaultView]);

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
        {/* NOT gated on `loaded`. Withholding the composer until an account
            lookup returns turns a slow or failed request into a page with
            nothing to type in, which is indistinguishable from the product
            being broken. `hasConnectedAccount` is false until we know better,
            and false is the state the empty state already handles.

            KEYED ON THE CONVERSATION. Remounting on a switch is what keeps the
            thread id and its history inseparable: React cannot hand the next
            conversation a list left over from the last one. */}
        <Playground
          hasConnectedAccount={hasConnectedAccount}
          initialMessages={thread.history}
          key={`${thread.id ?? "new"}:${thread.epoch}`}
          layout="page"
          loadSuggestions={loadSuggestions}
          onConversationChanged={refreshList}
          prompts={AGENT_PROMPTS}
          ref={ref}
          threadId={thread.id}
        />
      </div>
    </div>
  );
}
