"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import posthog from "posthog-js";
import { EVENTS } from "@/lib/analytics";
import { SetupInstructions } from "@/components/setup-instructions";

const POLL_MS = 5000;

type SetupStatus = {
  accountConnected: boolean;
  agentConnected: boolean;
  agentClientName: string | null;
  agentConnectedAt: string | null;
  firstToolCallAt: string | null;
};

// The client picker + per-client instructions live in the shared
// SetupInstructions component (also rendered on /docs/getting-started).
// This wizard adds what only makes sense signed-in on the dashboard:
// the live connection-status poller and the first-tool-call milestone.
export function SetupWizard() {
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
      // transient network failure — next poll retries
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

  const attention = !!status?.accountConnected && !status?.agentConnected;

  const statusMessage = complete
    ? "First tool call received 🎉"
    : status?.agentConnected
      ? "Client connected ✓ — now ask it something"
      : "Waiting for your client to connect…";

  return (
    <div
      className={`mt-10 ${
        attention
          ? "rounded-xl border-2 border-primary/30 bg-primary/[0.03] p-5"
          : ""
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-base font-bold text-foreground">
            Connect your AI client
          </h2>
          {attention && (
            <span className="inline-flex shrink-0 items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              Next step
            </span>
          )}
        </div>
        {status?.agentConnected && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Connected via {status.agentClientName ?? "your agent"} ✓
          </span>
        )}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Pick your client below for exact setup steps, then watch the status
        update live once it connects.
      </p>

      <div className="mt-3">
        <SetupInstructions sourcePrefix="wizard" />
      </div>

      {/* Live status */}
      <div className="mt-4 rounded-xl border border-border p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-sm font-semibold text-foreground">
            Connection status
          </h3>
          {!complete && status && (
            <span className="text-[11px] text-muted-foreground">
              checking every few seconds…
            </span>
          )}
        </div>
        <p className="mt-2 text-xs text-foreground">{statusMessage}</p>
      </div>
    </div>
  );
}
