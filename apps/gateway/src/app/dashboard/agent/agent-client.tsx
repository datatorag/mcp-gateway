"use client";

import { useCallback, useEffect, useRef } from "react";
import posthog from "posthog-js";
import { EVENTS } from "@/lib/analytics";
import { Playground, type PlaygroundHandle } from "../playground";
import { AGENT_PROMPTS } from "../agent-prompts";
import { useSignupConversion } from "../use-signup-conversion";
import { useConnections } from "../use-connections";

/**
 * The Agent, on its own route.
 *
 * It was previously the last block of a long dashboard page, reachable by
 * scrolling. Giving it a route is what lets it be a destination: something to
 * link to, to land on after login, and to come back to.
 */
export function AgentClient({ isDefaultView }: { isDefaultView: boolean }) {
  const { loaded, hasConnectedAccount } = useConnections();
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


  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-foreground">Agent</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Ask for something and it works across your connected accounts.
      </p>
      {loaded && (
        <Playground
          hasConnectedAccount={hasConnectedAccount}
          loadSuggestions={loadSuggestions}
          prompts={AGENT_PROMPTS}
          ref={ref}
        />
      )}
    </div>
  );
}
