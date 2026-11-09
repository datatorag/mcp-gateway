"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import posthog from "posthog-js";
import { Play, Copy, Check, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { EVENTS } from "@/lib/analytics";
import { ServiceIcon } from "@/components/service-icon";
import { ClientIcon } from "@/components/client-icon";
import { Button } from "@/components/ui/button";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import {
  CLIENT_GROUPS,
  DEFAULT_MCP_URL,
  MCP_CLIENTS,
  clientConfig,
  clientDeepLink,
  clientDetailHref,
  type ClientId,
  type McpClient,
} from "@/lib/mcp-clients";
import type { Suggestion } from "@/gateway/agent/suggestion-generator";
import {
  PROMPT_CARDS_STANDFIRST,
  PROMPT_CARD_RUN_LABEL,
} from "./agent-composer-copy";
import { PREVIEW_SUGGESTIONS, suggestionServiceIcons } from "./agent-prompts";
import { useSignupConversion } from "./use-signup-conversion";
import { useConnections } from "./use-connections";
import { SERVICES } from "./connections/services";
import { offeredServices } from "./connections/service-registry";
import type { ConnectedAccount, LegacyConnection } from "./connections/types";
import {
  HOME_CLIENTS_HEADING,
  HOME_CLIENTS_STANDFIRST,
  HOME_CONNECT_FIRST_NOTE,
  HOME_CTA,
  HOME_HEADLINE,
  HOME_MCP_HEADING,
  HOME_PROMPTS_HEADING,
  HOME_STANDFIRST,
  HOME_STATUS_HEADING,
  PROMPT_CARD_LOCKED_TITLE,
  STATUS_LABEL,
  type ServiceStatus,
} from "./home-copy";

/**
 * The dashboard home (SCRUM-482): a connect-your-client page. Top to bottom:
 * the headline with one call to action, example prompts, the client install
 * cards, the MCP server URL, and a strip saying which accounts are connected.
 * The connection cards themselves live on `/dashboard/connections`.
 *
 * Order rule: a user with nothing connected sees the client cards AND the
 * connect step, with a note that one account is needed before the first
 * call. Neither hides or gates the other.
 */
export function DashboardClient() {
  const connections = useConnections();
  const { hasConnectedAccount } = connections;
  const mcpUrl = useMcpUrl();

  useSignupConversion();

  return (
    <div className="space-y-10" data-home="">
      <Hero />
      <PromptCards hasConnectedAccount={hasConnectedAccount} />
      <ClientCards mcpUrl={mcpUrl} hasConnectedAccount={hasConnectedAccount} />
      <McpCard mcpUrl={mcpUrl} />
      <StatusStrip connections={connections} />
    </div>
  );
}

/** The server URL for this origin. Seeded with production's, corrected after
 * mount, the same as `SetupInstructions`. */
function useMcpUrl(): string {
  const [mcpUrl, setMcpUrl] = useState(DEFAULT_MCP_URL);
  useEffect(() => {
    setMcpUrl(`${window.location.origin}/mcp`);
  }, []);
  return mcpUrl;
}

const CLIENTS_ANCHOR = "connect-your-agent";

function Hero() {
  function scrollToClients(e: React.MouseEvent) {
    const target = document.getElementById(CLIENTS_ANCHOR);
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  return (
    <section data-section="hero">
      <h1 className="max-w-2xl font-display text-2xl font-bold text-foreground sm:text-3xl">
        {HOME_HEADLINE}
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        {HOME_STANDFIRST}
      </p>
      <Button
        className="mt-5"
        render={<a href={`#${CLIENTS_ANCHOR}`} onClick={scrollToClients} />}
      >
        {HOME_CTA}
        <ArrowRight data-icon="inline-end" />
      </Button>
    </section>
  );
}

function PromptCards({ hasConnectedAccount }: { hasConnectedAccount: boolean }) {
  const { copied, copy } = useCopyToClipboard<number>();
  const router = useRouter();

  /** The cards (SCRUM-110): the generator's suggestions for a connected user,
   * the locked preview otherwise. Never padded with the preview, whose shapes
   * may need a service this user does not have. */
  const [generated, setGenerated] = useState<Suggestion[] | null>(null);
  useEffect(() => {
    if (!hasConnectedAccount) return;
    let live = true;
    void fetch("/api/agent/suggestions?context=dashboard")
      .then((res) => (res.ok ? res.json() : { suggestions: [] }))
      .then((data: { suggestions?: Suggestion[] }) => {
        if (live) setGenerated(data.suggestions ?? []);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [hasConnectedAccount]);
  const cards = hasConnectedAccount ? (generated ?? []) : PREVIEW_SUGGESTIONS;
  // Shape ids only, never the text (SCRUM-321).
  useEffect(() => {
    if (!hasConnectedAccount || !generated || generated.length === 0) return;
    posthog.capture(EVENTS.AGENT_SUGGESTION_SHOWN, {
      context: "dashboard",
      shape_ids: generated.map((s) => s.id),
    });
  }, [hasConnectedAccount, generated]);

  /** Run means run (SCRUM-118): navigates to the agent carrying the SHAPE ID,
   * never the text. The agent page resolves the id server-side from the same
   * catalogue these cards come from, so there is no free-text parameter for
   * a crafted link to abuse, and an id that does not resolve seeds nothing. */
  function runPrompt(card: Suggestion, position: number) {
    if (!hasConnectedAccount) return;
    posthog.capture(EVENTS.AGENT_SUGGESTION_CLICKED, {
      context: "dashboard",
      shape_id: card.id,
      position,
    });
    router.push(`/dashboard/agent?prompt=${encodeURIComponent(card.id)}`);
  }

  return (
    <section data-section="prompts">
      <h2 className="font-display text-base font-bold text-foreground">
        {HOME_PROMPTS_HEADING}
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {PROMPT_CARDS_STANDFIRST}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card, i) => (
          <div
            key={card.id}
            data-prompt-card=""
            className="group relative flex flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/30"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5" data-prompt-icons="">
                {suggestionServiceIcons(card.id).map((s) => (
                  <ServiceIcon key={s} service={s} size={18} />
                ))}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => copy(card.text, i)}
                aria-label="Copy prompt"
                title="Copy"
                className="text-muted-foreground sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
              >
                {copied === i ? (
                  <Check className="size-3.5 text-success" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </Button>
            </div>
            <button
              data-prompt-run=""
              onClick={() => runPrompt(card, i)}
              disabled={!hasConnectedAccount}
              title={
                hasConnectedAccount
                  ? PROMPT_CARD_RUN_LABEL
                  : PROMPT_CARD_LOCKED_TITLE
              }
              className="flex flex-1 items-start gap-1.5 text-left text-sm leading-relaxed text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Play className="mt-1 size-3 shrink-0 fill-primary text-primary" />
              {card.text}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function ClientCards({
  mcpUrl,
  hasConnectedAccount,
}: {
  mcpUrl: string;
  hasConnectedAccount: boolean;
}) {
  const { copied, copy } = useCopyToClipboard<ClientId>();

  async function copyConfig(client: McpClient) {
    // A refused clipboard write is not a copy (use-copy-to-clipboard).
    if (!(await copy(clientConfig(client.id, mcpUrl), client.id))) return;
    posthog.capture(EVENTS.CLIENT_CARD_INSTALL_CLICKED, {
      client: client.id,
      action: "copy",
    });
    posthog.capture(EVENTS.COPY_MCP_CONFIG, {
      source: `home_${client.id}`,
      surface: "home",
    });
  }

  return (
    <section
      id={CLIENTS_ANCHOR}
      data-section="clients"
      className="scroll-mt-4"
    >
      <h2 className="font-display text-base font-bold text-foreground">
        {HOME_CLIENTS_HEADING}
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {HOME_CLIENTS_STANDFIRST}
      </p>
      {!hasConnectedAccount && (
        <p
          data-connect-first=""
          className="mt-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground"
        >
          {HOME_CONNECT_FIRST_NOTE}{" "}
          <Link
            href="/dashboard/connections"
            className="font-medium text-primary hover:underline"
          >
            Connect an account
          </Link>
        </p>
      )}
      <div className="mt-4 space-y-5">
        {CLIENT_GROUPS.map((group) => (
          <div key={group.id} data-client-group={group.id}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.label}
            </h3>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {MCP_CLIENTS.filter((c) => c.group === group.id).map((client) => {
                const deepLink = clientDeepLink(client.id, mcpUrl);
                const copyLabel =
                  copied === client.id
                    ? "Copied"
                    : client.payload === "url"
                      ? "Copy URL"
                      : client.payload === "command"
                        ? "Copy command"
                        : "Copy JSON";
                return (
                  <div
                    key={client.id}
                    data-client-card={client.id}
                    className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
                  >
                    <div className="flex items-center gap-2.5">
                      <ClientIcon icon={client.icon} size={18} />
                      <span className="text-sm font-semibold text-foreground">
                        {client.label}
                      </span>
                    </div>
                    <p className="flex-1 text-xs leading-relaxed text-muted-foreground">
                      {client.step}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {deepLink && (
                        <Button
                          size="sm"
                          render={
                            <a
                              href={deepLink}
                              onClick={() =>
                                posthog.capture(
                                  EVENTS.CLIENT_CARD_INSTALL_CLICKED,
                                  { client: client.id, action: "deep_link" }
                                )
                              }
                            />
                          }
                        >
                          Install
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant={deepLink ? "outline" : "default"}
                        onClick={() => void copyConfig(client)}
                      >
                        {copied === client.id ? <Check /> : <Copy />}
                        {copyLabel}
                      </Button>
                      <Link
                        href={clientDetailHref(client.id)}
                        className="ml-auto text-xs font-medium text-primary hover:underline"
                      >
                        Full steps
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function McpCard({ mcpUrl }: { mcpUrl: string }) {
  const { copied, copy } = useCopyToClipboard<boolean>();
  async function copyUrl() {
    if (!(await copy(mcpUrl, true))) return;
    posthog.capture(EVENTS.COPY_MCP_CONFIG, {
      source: "home_url",
      surface: "home",
    });
  }
  // One mark per client family, in the order the cards list them.
  const icons = [...new Set(MCP_CLIENTS.map((c) => c.icon))];
  return (
    <section
      data-section="mcp"
      className="rounded-xl border border-border bg-card p-4 sm:p-5"
    >
      <h2 className="font-display text-base font-bold text-foreground">
        {HOME_MCP_HEADING}
      </h2>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <code
          data-mcp-url=""
          className="min-w-0 flex-1 truncate rounded-lg border border-border bg-muted px-3 py-2 font-mono text-xs text-foreground"
        >
          {mcpUrl}
        </code>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void copyUrl()}
          aria-label="Copy MCP server URL"
        >
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Works in</span>
        {icons.map((icon) => (
          <ClientIcon key={icon} icon={icon} size={14} />
        ))}
        <span>and any MCP client that supports OAuth.</span>
      </div>
    </section>
  );
}

/** One provider's state from the connections view. `needs_reconnect` when the
 * last refresh said so for any of its accounts (SCRUM-190). */
export function serviceStatus(
  serviceId: string,
  accounts: ConnectedAccount[],
  legacy: LegacyConnection[]
): ServiceStatus {
  const rows = [
    ...accounts.filter((a) => a.connectorType === serviceId),
    ...legacy.filter((c) => c.service === serviceId),
  ];
  if (rows.length === 0) return "not_connected";
  if (rows.some((r) => r.refresh?.needsReconnect)) return "needs_reconnect";
  return "connected";
}

const STATUS_DOT: Record<ServiceStatus, string> = {
  connected: "bg-success",
  not_connected: "bg-muted-foreground/40",
  needs_reconnect: "bg-warning",
};

function StatusStrip({
  connections,
}: {
  connections: ReturnType<typeof useConnections>;
}) {
  const { accounts, legacyConnections, loaded, launchedServices } = connections;
  return (
    <section data-section="status">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-base font-bold text-foreground">
          {HOME_STATUS_HEADING}
        </h2>
        <Link
          href="/dashboard/connections"
          className="text-xs font-medium text-primary hover:underline"
        >
          Manage connections
        </Link>
      </div>
      <div className="mt-3 flex flex-wrap gap-2" aria-busy={!loaded}>
        {offeredServices(SERVICES, launchedServices).map((service) => {
          const status = serviceStatus(service.id, accounts, legacyConnections);
          return (
            <Link
              key={service.id}
              href="/dashboard/connections"
              data-status-chip={service.id}
              data-status={loaded ? status : "loading"}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card py-1.5 pl-1.5 pr-3 text-xs transition-colors hover:bg-secondary"
            >
              <span className="flex size-6 items-center justify-center rounded-full bg-secondary [&_svg]:size-4 [&_img]:size-4">
                {service.icon}
              </span>
              <span className="font-medium text-foreground">{service.name}</span>
              {loaded && (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className={`size-1.5 rounded-full ${STATUS_DOT[status]}`} />
                  {STATUS_LABEL[status]}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
