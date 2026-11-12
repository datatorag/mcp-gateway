"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import posthog from "posthog-js";
import { EVENTS } from "@/lib/analytics";

const POLL_MS = 5000;

type SetupStatus = {
  accountConnected: boolean;
  agentConnected: boolean;
  agentClientName: string | null;
  agentConnectedAt: string | null;
  firstToolCallAt: string | null;
};

/**
 * The live half of the retired SetupWizard (SCRUM-122). The wizard was
 * SetupInstructions plus this poller; when the dashboard IA change removed the
 * wizard, the config kept a page and the poller vanished from the product,
 * so a user pasting their MCP config had no way to see whether pasting
 * worked. This restores that feedback next to the config it verifies: the
 * block above says what to paste, this block says whether it connected.
 *
 * DISPLAY, NOT INSTRUMENTATION. Every state here is read from
 * /api/setup/status, which derives it from rows the gateway already writes
 * (connected accounts, live non-web OAuth client tokens, first_tool_call_at).
 * The one event captured below is the pre-existing client-side milestone
 * marker, kept under its historical name so its series stays continuous.
 *
 * The polling behaviour carries over from the wizard unchanged: fetch once on
 * mount, then every 5 seconds while incomplete, skipping ticks while the tab
 * is hidden, and stopping for good once the first tool call has landed. That
 * end state cannot regress, so there is nothing left to watch.
 */
export function ConnectionStatus() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  // undefined = "haven't observed a status fetch yet"; used to make sure we
  // only fire wizard_step_completed on a live false->true transition, never
  // on the very first status load (which could already be true from a prior
  // session) and never on every poll tick.
  const prevFirstToolCallRef = useRef<string | null | undefined>(undefined);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/setup/status");
      if (res.ok) setStatus(await res.json());
    } catch {
      // transient network failure, next poll retries
    }
  }, []);

  const complete = !!status?.firstToolCallAt;

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Keep polling while setup is incomplete so the user can leave this page
  // open, configure their agent, and watch status flip live.
  useEffect(() => {
    if (complete) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") fetchStatus();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [complete, fetchStatus]);

  useEffect(() => {
    if (!status) return;
    const prev = prevFirstToolCallRef.current;
    if (prev !== undefined && !prev && status.firstToolCallAt) {
      posthog.capture(EVENTS.WIZARD_STEP_COMPLETED, {
        step: "first_tool_call",
      });
    }
    prevFirstToolCallRef.current = status.firstToolCallAt;
  }, [status]);

  const statusMessage = complete
    ? "First tool call received 🎉"
    : status?.agentConnected
      ? "Client connected ✓. Now ask it something."
      : "Waiting for your client to connect…";

  return (
    <div className="mt-6 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold text-foreground">
          Connection status
        </h2>
        {status?.agentConnected ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Connected via {status.agentClientName ?? "your agent"} ✓
          </span>
        ) : (
          !complete &&
          status && (
            <span className="text-[11px] text-muted-foreground">
              checking every few seconds…
            </span>
          )
        )}
      </div>
      <p className="mt-2 text-xs text-foreground">{statusMessage}</p>
    </div>
  );
}
