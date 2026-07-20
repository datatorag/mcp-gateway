"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import posthog from "posthog-js";
import { EVENTS } from "@/lib/analytics";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";

const POLL_MS = 5000;

type SetupStatus = {
  accountConnected: boolean;
  agentConnected: boolean;
  agentClientName: string | null;
  agentConnectedAt: string | null;
  firstToolCallAt: string | null;
};

type ClientId =
  | "claude-web"
  | "claude-desktop"
  | "claude-code"
  | "cursor"
  | "chatgpt";

const CLIENTS: { id: ClientId; label: string }[] = [
  { id: "claude-web", label: "Claude web" },
  { id: "claude-desktop", label: "Claude Desktop" },
  { id: "claude-code", label: "Claude Code" },
  { id: "cursor", label: "Cursor" },
  { id: "chatgpt", label: "ChatGPT" },
];

type CopyFn = (text: string, key: string) => void;

function CodeBlock({
  children,
  copyKey,
  copied,
  onCopy,
}: {
  children: string;
  copyKey: string;
  copied: string | null;
  onCopy: CopyFn;
}) {
  return (
    <div className="relative mt-2">
      <pre className="overflow-x-auto rounded-xl border border-border bg-[#1C1917] p-4 font-mono text-xs leading-relaxed text-[#E7E5E4]">
        {children}
      </pre>
      <button
        onClick={() => onCopy(children, copyKey)}
        className="absolute right-2.5 top-2.5 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[11px] font-medium text-[#E7E5E4] transition-colors hover:bg-white/10"
      >
        {copied === copyKey ? "Copied ✓" : "Copy"}
      </button>
    </div>
  );
}

function ClientInstructions({
  client,
  mcpUrl,
  copied,
  onCopy,
}: {
  client: ClientId;
  mcpUrl: string;
  copied: string | null;
  onCopy: CopyFn;
}) {
  if (client === "claude-web" || client === "claude-desktop") {
    return (
      <ol className="space-y-2 text-xs text-muted-foreground">
        <li>1. Open Settings → Connectors</li>
        <li>2. Click &quot;Add custom connector&quot;</li>
        <li>
          3. Paste this URL:
          <CodeBlock copyKey="url" copied={copied} onCopy={onCopy}>
            {mcpUrl}
          </CodeBlock>
        </li>
        <li>4. Complete the sign-in when prompted</li>
      </ol>
    );
  }

  if (client === "claude-code") {
    const command = `claude mcp add --transport http datatorag ${mcpUrl}`;
    return (
      <div className="text-xs text-muted-foreground">
        <p>Run this command in your terminal:</p>
        <CodeBlock copyKey="command" copied={copied} onCopy={onCopy}>
          {command}
        </CodeBlock>
      </div>
    );
  }

  if (client === "cursor") {
    const json = `{
  "mcpServers": {
    "datatorag": {
      "url": "${mcpUrl}"
    }
  }
}`;
    return (
      <div className="text-xs text-muted-foreground">
        <p>Add this to your MCP config:</p>
        <CodeBlock copyKey="json" copied={copied} onCopy={onCopy}>
          {json}
        </CodeBlock>
        <p className="mt-2">Or via UI: Settings → MCP → Add</p>
      </div>
    );
  }

  // chatgpt
  return (
    <ol className="space-y-2 text-xs text-muted-foreground">
      <li>1. Open Settings → Connectors</li>
      <li>2. Enable Developer mode</li>
      <li>3. Click &quot;Create&quot;</li>
      <li>
        4. Paste this URL:
        <CodeBlock copyKey="url" copied={copied} onCopy={onCopy}>
          {mcpUrl}
        </CodeBlock>
      </li>
    </ol>
  );
}

export function SetupWizard() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [selectedClient, setSelectedClient] =
    useState<ClientId>("claude-web");
  const [mcpUrl, setMcpUrl] = useState("");
  const { copied, copy } = useCopyToClipboard<string>();
  // undefined = "haven't observed a status fetch yet"; used to make sure we
  // only fire wizard_step_completed on a live false->true transition, never
  // on the very first status load (which could already be true from a prior
  // session) and never on every poll tick.
  const prevFirstToolCallRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    setMcpUrl(`${window.location.origin}/mcp`);
  }, []);

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

  function selectClient(client: ClientId) {
    setSelectedClient(client);
    posthog.capture(EVENTS.WIZARD_CLIENT_SELECTED, { client });
  }

  function handleCopy(text: string, key: string) {
    copy(text, key);
    posthog.capture(EVENTS.COPY_MCP_CONFIG, {
      source: `wizard_${selectedClient}`,
    });
  }

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

      {/* Client selector */}
      <div className="mt-3 flex flex-wrap gap-2">
        {CLIENTS.map((c) => (
          <button
            key={c.id}
            onClick={() => selectClient(c.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              selectedClient === c.id
                ? "bg-primary text-primary-foreground"
                : "border border-border text-muted-foreground hover:bg-secondary"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Per-client instructions */}
      <div className="mt-4 rounded-xl border border-border p-4">
        <h3 className="font-display text-sm font-semibold text-foreground">
          {CLIENTS.find((c) => c.id === selectedClient)?.label}
        </h3>
        <div className="mt-2">
          <ClientInstructions
            client={selectedClient}
            mcpUrl={mcpUrl}
            copied={copied}
            onCopy={handleCopy}
          />
        </div>
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
