"use client";

import { useEffect, useState } from "react";
import posthog from "posthog-js";
import { EVENTS } from "@/lib/analytics";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";

// Shared client-connection instructions — the single source of truth for "how
// do I hook my agent up to DataToRAG", rendered by BOTH the dashboard setup
// wizard and /docs/getting-started so the two can never drift (SCRUM-24).
// `sourcePrefix` keeps the two surfaces distinguishable in analytics:
// the dashboard keeps its historical `wizard_${client}` copy_mcp_config
// source values; docs emits `docs_${client}`.

export type ClientId =
  | "claude-web"
  | "claude-desktop"
  | "claude-code"
  | "cursor"
  | "chatgpt";

export const CLIENTS: { id: ClientId; label: string }[] = [
  { id: "claude-web", label: "Claude web" },
  { id: "claude-desktop", label: "Claude Desktop" },
  { id: "claude-code", label: "Claude Code" },
  { id: "cursor", label: "Cursor" },
  { id: "chatgpt", label: "ChatGPT" },
];

function CodeBlock({
  children,
  onCopied,
}: {
  children: string;
  /** Fired on copy, after the clipboard write — analytics hook. */
  onCopied?: () => void;
}) {
  const { copied, copy } = useCopyToClipboard<boolean>();
  return (
    <div className="relative mt-2">
      <pre className="overflow-x-auto rounded-xl border border-border bg-[#1C1917] p-4 font-mono text-xs leading-relaxed text-[#E7E5E4]">
        {children}
      </pre>
      <button
        onClick={() => {
          copy(children, true);
          onCopied?.();
        }}
        className="absolute right-2.5 top-2.5 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[11px] font-medium text-[#E7E5E4] transition-colors hover:bg-white/10"
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>
    </div>
  );
}

function ClientInstructions({
  client,
  mcpUrl,
  onCopied,
}: {
  client: ClientId;
  mcpUrl: string;
  onCopied?: () => void;
}) {
  if (client === "claude-web" || client === "claude-desktop") {
    return (
      <ol className="space-y-2 text-xs text-muted-foreground">
        <li>1. Open Settings → Connectors</li>
        <li>2. Click &quot;Add custom connector&quot;</li>
        <li>
          3. Paste this URL:
          <CodeBlock onCopied={onCopied}>{mcpUrl}</CodeBlock>
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
        <CodeBlock onCopied={onCopied}>{command}</CodeBlock>
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
        <CodeBlock onCopied={onCopied}>{json}</CodeBlock>
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
        <CodeBlock onCopied={onCopied}>{mcpUrl}</CodeBlock>
      </li>
    </ol>
  );
}

export function SetupInstructions({
  sourcePrefix,
}: {
  /** Analytics surface: "wizard" (dashboard) or "docs" (/docs/getting-started). */
  sourcePrefix: "wizard" | "docs";
}) {
  const [selectedClient, setSelectedClient] = useState<ClientId>("claude-web");
  const [mcpUrl, setMcpUrl] = useState("");

  useEffect(() => {
    setMcpUrl(`${window.location.origin}/mcp`);
  }, []);

  function selectClient(client: ClientId) {
    setSelectedClient(client);
    posthog.capture(EVENTS.WIZARD_CLIENT_SELECTED, {
      client,
      source: sourcePrefix,
    });
  }

  function handleCopied() {
    posthog.capture(EVENTS.COPY_MCP_CONFIG, {
      source: `${sourcePrefix}_${selectedClient}`,
    });
  }

  return (
    <div>
      {/* Client selector */}
      <div className="flex flex-wrap gap-2">
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
            onCopied={handleCopied}
          />
        </div>
      </div>
    </div>
  );
}
