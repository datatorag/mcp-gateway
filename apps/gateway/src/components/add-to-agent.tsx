"use client";

import { useEffect, useRef, useState } from "react";
import posthog from "posthog-js";
import { Check, Copy, ExternalLink } from "lucide-react";
import { EVENTS } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import { Button } from "@/components/ui/button";
import { ClientIcon } from "@/components/client-icon";
import { useMcpUrl } from "@/lib/use-mcp-url";
import {
  MCP_CLIENTS,
  clientById,
  clientConfig,
  clientDeepLink,
  clientIdsForRegisteredName,
  copyLabel,
  genericJson,
  isClientId,
  type ClientId,
  type McpClient,
} from "@/lib/mcp-clients";

/**
 * "Add to your agent" (SCRUM-503): pick any client and get its one step to
 * connect DataToRAG. The one implementation of the client step, mounted on
 * the Agent page, in the Agent's own answer when it offers the config, on the
 * dashboard home, in the getting-started docs, and on the site pages a
 * visitor lands on. The clients and their steps are data in
 * `lib/mcp-clients.ts`; nothing here names a client.
 *
 * Two layouts of the same parts:
 * - `compact`: a client menu, the step, and the button. Sized to sit above
 *   the Agent's composer without pushing it out of view, and to close a blog
 *   post.
 * - `full`: every client as a button, the step, the button, and what it
 *   copies, shown.
 *
 * The step's main action is the client's own add link where it documents one
 * and the link has been tried in the real client (`linkTried`); until then
 * the copy button leads and the link is second. Every other client has the
 * one copy button. Signed out, the block says the
 * account comes later: the client asks the visitor to sign in when it
 * connects.
 *
 * The pick is remembered in this browser. Signed in, a client that holds a
 * live token for this user is marked connected, from the same status the
 * dashboard home's live check reads.
 */

export type AddToAgentPlacement =
  | "agent"
  | "agent_chat"
  | "home"
  | "docs"
  | "site_home"
  | "blog"
  | "landing"
  | "page";

/** The pick, per browser. Not a preference on the account: a visitor has
 * none, and the browser is where the client is. */
export const PICK_KEY = "dtr-add-to-agent-client";

const DEFAULT_CLIENT: ClientId = "claude-web";

export function AddToAgent({
  placement,
  layout = "full",
  signedIn = false,
  heading = true,
  className,
}: {
  placement: AddToAgentPlacement;
  layout?: "compact" | "full";
  /** Signed in: the connected marks are read; signed out: the step adds that
   * the client will ask for a sign-in. */
  signedIn?: boolean;
  /** The block's own title line. Off where the page around it already says
   * what it is. */
  heading?: boolean;
  className?: string;
}) {
  const [clientId, setClientId] = useState<ClientId>(DEFAULT_CLIENT);
  const [restored, setRestored] = useState(false);
  const mcpUrl = useMcpUrl();
  const connected = useConnectedClients(signedIn);
  const rootRef = useRef<HTMLElement>(null);

  // The starting pick, after mount, so the first paint matches the server's
  // HTML: a client named in the URL (`?client=cursor`, or a hash: an old
  // `/dashboard#cursor` link still lands on its step, and is scrolled to),
  // then the remembered pick, then the default.
  useEffect(() => {
    const fromHash = window.location.hash.slice(1);
    const fromQuery = new URLSearchParams(window.location.search).get("client") ?? "";
    // A hash that is not a client (a tracking fragment) leaves the query its say.
    const linked = isClientId(fromHash) ? fromHash : isClientId(fromQuery) ? fromQuery : null;
    if (linked) {
      setClientId(linked);
      rootRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    } else {
      try {
        const saved = localStorage.getItem(PICK_KEY);
        if (saved && isClientId(saved)) setClientId(saved);
      } catch {
        // No storage: the default stands.
      }
    }
    setRestored(true);
  }, []);

  useShownOnce(rootRef, restored, () => {
    posthog.capture(EVENTS.ADD_TO_AGENT_SHOWN, { placement, client: clientId, signed_in: signedIn });
  });

  function pick(id: ClientId) {
    if (id === clientId) return;
    setClientId(id);
    try {
      localStorage.setItem(PICK_KEY, id);
    } catch {
      // A browser that will not remember still gets the step.
    }
    posthog.capture(EVENTS.ADD_TO_AGENT_CLIENT_PICKED, { placement, client: id });
  }

  const client = clientById(clientId);
  const compact = layout === "compact";

  return (
    <section
      ref={rootRef}
      data-add-to-agent={placement}
      data-layout={layout}
      aria-label="Add DataToRAG to your agent"
      className={cn(
        "rounded-xl border border-border bg-card text-left",
        compact ? "p-3 sm:p-4" : "p-4 sm:p-5",
        className
      )}
    >
      {heading && (
        <div className={compact ? "mb-2" : "mb-3"}>
          <h2 className={cn("font-display font-bold text-foreground", compact ? "text-sm" : "text-base")}>
            Add DataToRAG to your agent
          </h2>
          {!compact && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Pick the client you use. One step, and your agent has your tools.
            </p>
          )}
        </div>
      )}

      {compact ? (
        <ClientMenu clientId={clientId} connected={connected} onPick={pick} />
      ) : (
        <ClientButtons clientId={clientId} connected={connected} onPick={pick} />
      )}

      <Step
        client={client}
        mcpUrl={mcpUrl}
        placement={placement}
        compact={compact}
        signedIn={signedIn}
        connected={connected.has(client.id)}
      />
    </section>
  );
}

function ClientButtons({
  clientId,
  connected,
  onPick,
}: {
  clientId: ClientId;
  connected: Set<ClientId>;
  onPick: (id: ClientId) => void;
}) {
  return (
    <div role="group" aria-label="Your client" className="flex flex-wrap gap-2">
      {MCP_CLIENTS.map((c) => {
        const selected = c.id === clientId;
        return (
          <button
            key={c.id}
            type="button"
            data-client={c.id}
            aria-pressed={selected}
            onClick={() => onPick(c.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-3 text-xs font-medium transition-colors",
              selected
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:bg-secondary"
            )}
          >
            <ClientIcon icon={c.icon} size={14} />
            {c.label}
            {connected.has(c.id) && <ConnectedDot />}
          </button>
        );
      })}
    </div>
  );
}

/** The compact layout's picker: a native menu, one line at every width, and
 * the platform's own picker on a phone. */
function ClientMenu({
  clientId,
  connected,
  onPick,
}: {
  clientId: ClientId;
  connected: Set<ClientId>;
  onPick: (id: ClientId) => void;
}) {
  const client = clientById(clientId);
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <ClientIcon icon={client.icon} size={14} />
      <span className="sr-only">Your client</span>
      <select
        data-client-menu=""
        value={clientId}
        onChange={(e) => isClientId(e.target.value) && onPick(e.target.value)}
        className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs font-medium text-foreground"
      >
        {MCP_CLIENTS.map((c) => (
          <option key={c.id} value={c.id}>
            {connected.has(c.id) ? `${c.label} (connected)` : c.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Step({
  client,
  mcpUrl,
  placement,
  compact,
  signedIn,
  connected,
}: {
  client: McpClient;
  mcpUrl: string;
  placement: AddToAgentPlacement;
  compact: boolean;
  signedIn: boolean;
  connected: boolean;
}) {
  const { copied, copy } = useCopyToClipboard<boolean>();
  const deepLink = clientDeepLink(client.id, mcpUrl);
  const linkLeads = deepLink !== null && client.linkTried !== undefined;
  const payload = clientConfig(client.id, mcpUrl);

  async function copyPayload() {
    // A refused clipboard write is not a copy (use-copy-to-clipboard).
    if (!(await copy(payload, true))) return;
    posthog.capture(EVENTS.ADD_TO_AGENT_ACTION, { placement, client: client.id, action: "copy" });
    posthog.capture(EVENTS.COPY_MCP_CONFIG, { source: `${placement}_${client.id}`, surface: placement });
  }

  const copyButton = (
    <Button
      size="sm"
      variant={linkLeads ? "outline" : "default"}
      data-action="copy"
      onClick={() => void copyPayload()}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : copyLabel(client.payload)}
    </Button>
  );

  return (
    <div data-step={client.id} className={compact ? "mt-2" : "mt-4"}>
      {connected && (
        <p data-connected="" className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
          <ConnectedDot />
          Connected. {client.label} has signed in to DataToRAG.
        </p>
      )}
      <p className="text-xs leading-relaxed text-foreground">{client.step}</p>
      {!signedIn && (
        <p data-signed-out="" className="mt-1 text-xs leading-relaxed text-muted-foreground">
          No account needed first: your client asks you to sign in with Google when it connects.
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {!linkLeads && copyButton}
        {deepLink && (
          <Button
            size="sm"
            variant={linkLeads ? "default" : "outline"}
            data-action="link"
            render={
              <a
                href={deepLink}
                onClick={() =>
                  posthog.capture(EVENTS.ADD_TO_AGENT_ACTION, { placement, client: client.id, action: "link" })
                }
              />
            }
          >
            <ExternalLink />
            Add to {client.label}
          </Button>
        )}
        {linkLeads && copyButton}
      </div>

      {!compact && (
        <pre
          data-payload=""
          className="mt-3 overflow-x-auto rounded-lg border border-border bg-[#1C1917] p-3 font-mono text-xs leading-relaxed text-[#E7E5E4]"
        >
          {payload}
        </pre>
      )}
      {!compact && client.id === "other" && (
        <>
          <p className="mt-3 text-xs text-muted-foreground">A client that reads a config file takes this:</p>
          <pre className="mt-1.5 overflow-x-auto rounded-lg border border-border bg-[#1C1917] p-3 font-mono text-xs leading-relaxed text-[#E7E5E4]">
            {genericJson(mcpUrl)}
          </pre>
        </>
      )}

      {client.planNote && (
        <p data-plan-note="" className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {client.planNote}
        </p>
      )}
    </div>
  );
}

function ConnectedDot() {
  return <span aria-label="connected" className="inline-block size-1.5 rounded-full bg-success" />;
}

/** The clients holding a live token for this user, from `/api/setup/status`
 * (the dashboard home's live check). Empty when signed out, and on any
 * failure: a missing mark claims nothing. */
function useConnectedClients(signedIn: boolean): Set<ClientId> {
  const [ids, setIds] = useState<Set<ClientId>>(() => new Set());
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    void fetch("/api/setup/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { agentClientNames?: string[] } | null) => {
        if (!live || !data?.agentClientNames) return;
        setIds(new Set(data.agentClientNames.flatMap((name) => clientIdsForRegisteredName(name))));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [signedIn]);
  return ids;
}

/** Calls `onShown` once, the first time the block is at least half on
 * screen, and only after `ready` (so the event carries the restored pick).
 * Without an observer (an old browser, a test), it counts as shown. */
function useShownOnce(ref: React.RefObject<HTMLElement | null>, ready: boolean, onShown: () => void) {
  const fired = useRef(false);
  const callback = useRef(onShown);
  callback.current = onShown;
  useEffect(() => {
    if (!ready || fired.current) return;
    const el = ref.current;
    const fire = () => {
      if (fired.current) return;
      fired.current = true;
      callback.current();
    };
    if (!el || typeof IntersectionObserver === "undefined") {
      fire();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          fire();
          io.disconnect();
        }
      },
      { threshold: 0.5 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ready, ref]);
}
