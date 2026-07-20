"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import posthog from "posthog-js";
import { EVENTS } from "@/lib/analytics";
import { reportSignupConversion } from "@/components/google-ads";
import { SERVICES } from "./connections/services";
import { SetupWizard } from "./setup-wizard";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import type { ConnectedAccount, LegacyConnection } from "./connections/types";

const EXAMPLE_PROMPTS = [
  "Summarize my unread emails and draft a status update in Google Docs",
  "Find the latest sales deck in Drive and update the Q2 numbers in Slides",
  "Search Gmail for meeting notes from last week and create a summary doc",
  "Check my calendar for tomorrow and find related prep docs in Drive",
  "Create a Jira ticket from the action items in my last email thread",
  "Draft replies to my 5 most recent unanswered emails",
];

export function DashboardClient() {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [legacyConnections, setLegacyConnections] = useState<
    LegacyConnection[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const { copied, copy } = useCopyToClipboard<number>();

  const fetchConnections = useCallback(async () => {
    const res = await fetch("/api/connections");
    if (res.ok) {
      const data = await res.json();
      setAccounts(data.accounts ?? []);
      setLegacyConnections(data.connections ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  // The OAuth callback redirects first-time users to /dashboard?signup=1.
  // Fire the Google Ads signup conversion once, then strip the param so a
  // refresh (or a shared URL) can't re-fire it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("signup") === "1") {
      reportSignupConversion();
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  async function disconnectAccount(e: React.MouseEvent, account: ConnectedAccount) {
    e.preventDefault();
    e.stopPropagation();
    setDisconnecting(account.id);
    await fetch(`/api/connections?accountId=${account.id}`, {
      method: "DELETE",
    });
    setAccounts((prev) => prev.filter((a) => a.id !== account.id));
    setDisconnecting(null);
    posthog.capture(EVENTS.CONNECTOR_REMOVED, {
      connector: account.connectorType,
    });
  }

  async function disconnectLegacy(e: React.MouseEvent, service: string) {
    e.preventDefault();
    e.stopPropagation();
    setDisconnecting(service);
    await fetch(`/api/connections?service=${service}`, { method: "DELETE" });
    setLegacyConnections((prev) => prev.filter((c) => c.service !== service));
    setDisconnecting(null);
    posthog.capture(EVENTS.CONNECTOR_REMOVED, { connector: service });
  }

  return (
    <div>
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect your accounts and start using AI with your data.
        </p>
      </div>

      {/* Service cards */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {loading ? (
          <div className="col-span-full py-8 text-center text-sm text-muted-foreground">
            Loading...
          </div>
        ) : (
          SERVICES.map((service) => {
            const serviceAccounts = accounts.filter(
              (a) => a.connectorType === service.id
            );
            const legacyConn = legacyConnections.find(
              (c) => c.service === service.id
            );
            const hasAccounts = serviceAccounts.length > 0;
            const isConnected = hasAccounts || !!legacyConn;

            return (
              <div
                key={service.id}
                className="flex flex-col rounded-xl border border-border shadow-sm"
              >
                {/* Card header */}
                <div className="p-5 pb-0">
                  <div className="flex items-start gap-3.5">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
                      {service.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-display text-sm font-semibold text-foreground">
                          {service.name}
                        </h3>
                        {isConnected ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            Connected
                          </span>
                        ) : (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                            Not connected
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {service.description}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Capabilities */}
                <div className="flex-1 px-5 py-4">
                  <ul className="space-y-1.5">
                    {service.capabilities.map((cap) => (
                      <li
                        key={cap}
                        className="flex items-start gap-2 text-xs text-muted-foreground"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 16 16"
                          fill="none"
                          className="mt-px shrink-0 text-muted-foreground/40"
                        >
                          <circle
                            cx="8"
                            cy="8"
                            r="2"
                            fill="currentColor"
                          />
                        </svg>
                        {cap}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Connected accounts (compact) */}
                {hasAccounts && (
                  <div className="space-y-1 border-t border-border px-5 py-3">
                    {serviceAccounts.map((account) => (
                      <div
                        key={account.id}
                        className="flex items-center justify-between gap-2"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-medium text-primary">
                            {account.accountEmail[0].toUpperCase()}
                          </div>
                          <span className="truncate text-xs text-foreground">
                            {account.accountEmail}
                          </span>
                          {account.isDefault && (
                            <span className="shrink-0 text-[10px] font-medium text-primary">
                              Default
                            </span>
                          )}
                        </div>
                        <button
                          onClick={(e) => disconnectAccount(e, account)}
                          disabled={disconnecting === account.id}
                          className="shrink-0 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                        >
                          {disconnecting === account.id
                            ? "..."
                            : "Disconnect"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Legacy connection */}
                {!hasAccounts && legacyConn && (
                  <div className="flex items-center justify-between border-t border-border px-5 py-3">
                    <p className="text-[11px] text-muted-foreground">
                      Connected{" "}
                      {new Date(legacyConn.connectedAt).toLocaleDateString(
                        "en-US",
                        { month: "short", day: "numeric", year: "numeric" }
                      )}
                    </p>
                    <button
                      onClick={(e) => disconnectLegacy(e, service.id)}
                      disabled={disconnecting === service.id}
                      className="shrink-0 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                    >
                      {disconnecting === service.id ? "..." : "Disconnect"}
                    </button>
                  </div>
                )}

                {/* Actions footer */}
                <div className="border-t border-border px-5 py-3">
                  {isConnected ? (
                    <div className="flex gap-2">
                      <Link
                        href={`/dashboard/connections/${service.id}`}
                        className="flex-1 rounded-[var(--radius)] border border-border py-1.5 text-center text-xs font-medium text-foreground transition-colors hover:bg-secondary"
                      >
                        Playground
                      </Link>
                      <a
                        href={service.connectUrl}
                        onClick={() =>
                          posthog.capture(EVENTS.CONNECTOR_ADDED, {
                            connector: service.id,
                            mode: "add_account",
                          })
                        }
                        className="rounded-[var(--radius)] border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      >
                        Add account
                      </a>
                    </div>
                  ) : (
                    <a
                      href={service.connectUrl}
                      onClick={() =>
                        posthog.capture(EVENTS.CONNECTOR_ADDED, {
                          connector: service.id,
                          mode: "first_connect",
                        })
                      }
                      className="block rounded-[var(--radius)] bg-primary py-1.5 text-center text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                      Connect
                    </a>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Agent setup wizard + live connection status */}
      <SetupWizard />

      {/* What can I do? */}
      <div className="mt-10">
        <h2 className="font-display text-base font-bold text-foreground">
          What can I do?
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Try these with your AI assistant. Click to copy.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {EXAMPLE_PROMPTS.map((prompt, i) => (
            <button
              key={i}
              onClick={() => copy(prompt, i)}
              className="group relative rounded-lg border border-border px-3 py-2.5 text-left text-xs leading-relaxed text-foreground transition-colors hover:border-primary/30 hover:bg-secondary/50"
            >
              <span className="pr-5">{prompt}</span>
              <span className="absolute right-2.5 top-2.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                {copied === i ? (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-emerald-500"
                  >
                    <path d="M3 8.5l3.5 3.5L13 4" />
                  </svg>
                ) : (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="5" y="5" width="8" height="8" rx="1.5" />
                    <path d="M3 11V3.5A.5.5 0 013.5 3H11" />
                  </svg>
                )}
              </span>
            </button>
          ))}
        </div>
      </div>

    </div>
  );
}
