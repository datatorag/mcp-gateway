"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import posthog from "posthog-js";
import { EVENTS } from "@/lib/analytics";
import { Playground, type PlaygroundHandle } from "../playground";
import { AGENT_PROMPTS } from "../agent-prompts";
import { useSignupConversion } from "../use-signup-conversion";
import type { ConnectedAccount, LegacyConnection } from "../connections/types";

/**
 * The Agent, on its own route.
 *
 * It was previously the last block of a long dashboard page, reachable by
 * scrolling. Giving it a route is what lets it be a destination: something to
 * link to, to land on after login, and to come back to.
 */
export function AgentClient({ isDefaultView }: { isDefaultView: boolean }) {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [legacy, setLegacy] = useState<LegacyConnection[]>([]);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<PlaygroundHandle>(null);
  const hasConnectedAccount = accounts.length > 0 || legacy.length > 0;

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

  const fetchConnections = useCallback(async () => {
    const res = await fetch("/api/connections");
    if (res.ok) {
      const data = await res.json();
      setAccounts(data.accounts ?? []);
      setLegacy(data.connections ?? []);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  // Whether a new user actually LANDED here, rather than navigating to it, is
  // what separates a "landed on Agent" cohort from everyone else in the funnel.
  // Fired once per mount, and only when the route was the destination.
  useEffect(() => {
    if (isDefaultView) posthog.capture(EVENTS.AGENT_DEFAULT_VIEW_SHOWN);
  }, [isDefaultView]);

  // Connecting leaves and comes back, so the answer to "did it work" has to be
  // re-read on return rather than assumed from before the redirect.
  useEffect(() => {
    const onFocus = () => void fetchConnections();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchConnections]);

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
