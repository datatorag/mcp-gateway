"use client";

import { useCallback, useEffect, useState } from "react";
import posthog from "posthog-js";
import { EVENTS } from "@/lib/analytics";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";

const MCP_CONFIG = `{
  "mcpServers": {
    "datatorag": {
      "url": "https://datatorag.com/mcp"
    }
  }
}`;

const POLL_MS = 5000;

type SetupStatus = {
  accountConnected: boolean;
  agentConnected: boolean;
  agentClientName: string | null;
  agentConnectedAt: string | null;
  firstToolCallAt: string | null;
};

function StepIcon({ done, active }: { done: boolean; active: boolean }) {
  if (done) {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
        <svg
          width="11"
          height="11"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-emerald-500"
        >
          <path d="M3 8.5l3.5 3.5L13 4" />
        </svg>
      </span>
    );
  }
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center">
      <span
        className={`h-2.5 w-2.5 rounded-full ${
          active ? "animate-pulse bg-amber-500" : "bg-muted-foreground/25"
        }`}
      />
    </span>
  );
}

export function ConnectionTester() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const { copied, copy } = useCopyToClipboard<boolean>();

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
  // open, configure their agent, and watch each step flip green.
  useEffect(() => {
    if (complete) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") fetchStatus();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [complete, fetchStatus]);

  function copyConfig() {
    copy(MCP_CONFIG, true);
    posthog.capture(EVENTS.COPY_MCP_CONFIG, { source: "dashboard_button" });
  }

  const steps = [
    {
      label: "Connect an account",
      detail: status?.accountConnected
        ? "Account linked"
        : "Connect Google Workspace or Atlassian above",
      done: !!status?.accountConnected,
    },
    {
      label: "Connect your AI agent",
      detail: status?.agentConnected
        ? `${status.agentClientName ?? "Your agent"} is connected`
        : "Add the config below to your MCP client, then approve the login prompt",
      done: !!status?.agentConnected,
    },
    {
      label: "Make your first tool call",
      detail: status?.firstToolCallAt
        ? "You're live — your agent can use your data"
        : "Ask your agent something, e.g. “summarize my unread emails”",
      done: complete,
    },
  ];
  const activeIndex = steps.findIndex((s) => !s.done);

  return (
    <div className="mt-10">
      <h2 className="font-display text-base font-bold text-foreground">
        Connect your AI agent
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Add this to your MCP client config (Claude, Cursor, etc.), then watch
        the checklist below — it updates live as your agent connects.
      </p>

      <div className="relative mt-3">
        <pre
          onCopy={() =>
            posthog.capture(EVENTS.COPY_MCP_CONFIG, { source: "dashboard" })
          }
          className="overflow-x-auto rounded-xl border border-border bg-[#1C1917] p-4 font-mono text-xs leading-relaxed text-[#E7E5E4]"
        >
          {MCP_CONFIG}
        </pre>
        <button
          onClick={copyConfig}
          className="absolute right-2.5 top-2.5 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[11px] font-medium text-[#E7E5E4] transition-colors hover:bg-white/10"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>

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
        <ul className="mt-3 space-y-3">
          {steps.map((step, i) => (
            <li key={step.label} className="flex items-start gap-2.5">
              <StepIcon done={step.done} active={i === activeIndex} />
              <div className="min-w-0">
                <p
                  className={`text-xs font-medium ${
                    step.done ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {step.label}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {step.detail}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
