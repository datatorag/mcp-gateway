"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import posthog from "posthog-js";
import { Play, Copy, Check } from "lucide-react";
import { EVENTS } from "@/lib/analytics";
import { CasaBadge } from "@/components/casa-badge";
import { reportSignupConversion } from "@/components/google-ads";
import { SERVICES } from "./connections/services";
import { ServiceIcon } from "@/components/service-icon";
import { SetupWizard } from "./setup-wizard";
import { Playground, type PlaygroundHandle } from "./playground";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatConnectedDate } from "@/lib/utils";
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
  const playgroundRef = useRef<PlaygroundHandle>(null);
  const hasConnectedAccount = accounts.length > 0 || legacyConnections.length > 0;

  function runPrompt(prompt: string) {
    if (!hasConnectedAccount) return;
    playgroundRef.current?.runPrompt(prompt);
  }

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
          Connect your accounts and start using AI with your data. New here?
          Read the{" "}
          <Link
            href="/docs/getting-started"
            className="font-medium text-primary hover:underline"
          >
            Getting Started guide
          </Link>
          .
        </p>
      </div>

      {/* Shown before the consent-screen step the Connect buttons lead to. */}
      <CasaBadge className="mt-4" />

      {/* Service cards */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {loading ? (
          Array.from({ length: 2 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <div className="flex items-start gap-3.5">
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <div className="space-y-2 pt-1">
                    <Skeleton className="h-3.5 w-32" />
                    <Skeleton className="h-3 w-44" />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
              </CardContent>
            </Card>
          ))
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
              <Card key={service.id}>
                <CardHeader>
                  <div className="flex items-start gap-3.5">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
                      {service.icon}
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-sm font-semibold">
                        {service.name}
                      </CardTitle>
                      <CardDescription className="text-xs">
                        {service.description}
                      </CardDescription>
                    </div>
                  </div>
                  <CardAction>
                    {isConnected ? (
                      <Badge variant="success">
                        <span className="size-1.5 rounded-full bg-current" />
                        Connected
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-muted-foreground">
                        <span className="size-1.5 rounded-full bg-muted-foreground/40" />
                        Not connected
                      </Badge>
                    )}
                  </CardAction>
                </CardHeader>

                {/* Capabilities */}
                <CardContent className="flex-1">
                  <ul className="space-y-1.5">
                    {service.capabilities.map((cap) => (
                      <li
                        key={cap.text}
                        className="flex items-start gap-2 text-xs text-muted-foreground"
                      >
                        <span className="flex shrink-0 items-center gap-1 pt-px">
                          {cap.services.map((s) => (
                            <ServiceIcon key={s} service={s} size={14} />
                          ))}
                        </span>
                        {cap.text}
                      </li>
                    ))}
                  </ul>
                </CardContent>

                {/* Connected accounts (compact) */}
                {hasAccounts && (
                  <CardContent className="space-y-1 border-t pt-4">
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
                            <Badge
                              variant="secondary"
                              className="bg-primary/10 text-primary"
                            >
                              Default
                            </Badge>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={(e) => disconnectAccount(e, account)}
                          disabled={disconnecting === account.id}
                          className="text-muted-foreground"
                        >
                          {disconnecting === account.id ? "..." : "Disconnect"}
                        </Button>
                      </div>
                    ))}
                  </CardContent>
                )}

                {/* Legacy connection */}
                {!hasAccounts && legacyConn && (
                  <CardContent className="flex items-center justify-between border-t pt-4">
                    <p className="text-[11px] text-muted-foreground">
                      Connected {formatConnectedDate(legacyConn.connectedAt)}
                    </p>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={(e) => disconnectLegacy(e, service.id)}
                      disabled={disconnecting === service.id}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      {disconnecting === service.id ? "..." : "Disconnect"}
                    </Button>
                  </CardContent>
                )}

                {/* Actions footer */}
                <CardFooter className="gap-2">
                  {isConnected ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        render={
                          <Link href={`/dashboard/connections/${service.id}`} />
                        }
                      >
                        Playground
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        render={
                          <a
                            href={service.connectUrl}
                            onClick={() =>
                              posthog.capture(EVENTS.CONNECTOR_ADDED, {
                                connector: service.id,
                                mode: "add_account",
                              })
                            }
                          />
                        }
                      >
                        Add account
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      className="w-full"
                      render={
                        <a
                          href={service.connectUrl}
                          onClick={() =>
                            posthog.capture(EVENTS.CONNECTOR_ADDED, {
                              connector: service.id,
                              mode: "first_connect",
                            })
                          }
                        />
                      }
                    >
                      Connect
                    </Button>
                  )}
                </CardFooter>
              </Card>
            );
          })
        )}
      </div>

      {/* The activation moment: an account is connected and the honest next
          question is "what do I actually do now?". Answer it here rather
          than leaving an empty playground to answer it. */}
      {hasConnectedAccount && (
        <Link
          className="group mt-10 flex items-start justify-between gap-4 rounded-xl border border-primary/30 bg-primary/[0.03] p-5 transition-colors hover:bg-primary/[0.06]"
          href="/skills"
        >
          <div>
            <h2 className="font-display text-base font-bold text-foreground">
              Connected. Now teach Claude what to do with it
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Working skills you can copy straight into your client: triage
              your inbox, see your week across every calendar, keep a
              knowledge base in Sheets.
            </p>
          </div>
          <span className="mt-1 shrink-0 text-sm font-medium text-primary">
            Browse skills &rarr;
          </span>
        </Link>
      )}

      {/* What can I do? */}
      <div className="mt-10">
        <h2 className="font-display text-base font-bold text-foreground">
          What can I do?
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Run one below in the playground, or copy it into your own AI client.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {EXAMPLE_PROMPTS.map((prompt, i) => (
            <div
              key={i}
              className="group flex items-start gap-2 rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:border-primary/30 hover:bg-secondary/50"
            >
              <button
                onClick={() => runPrompt(prompt)}
                disabled={!hasConnectedAccount}
                title={
                  hasConnectedAccount
                    ? "Run in playground"
                    : "Connect an account to run this"
                }
                className="flex flex-1 items-start gap-1.5 text-left text-xs leading-relaxed text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Play className="mt-0.5 size-3 shrink-0 fill-primary text-primary" />
                {prompt}
              </button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => copy(prompt, i)}
                aria-label="Copy prompt"
                title="Copy"
                className="text-muted-foreground opacity-0 group-hover:opacity-100"
              >
                {copied === i ? (
                  <Check className="size-3.5 text-emerald-500" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* Live playground chat */}
      <Playground
        ref={playgroundRef}
        prompts={EXAMPLE_PROMPTS}
        hasConnectedAccount={hasConnectedAccount}
      />

      {/* Agent setup wizard + live connection status */}
      <div id="setup-wizard">
        <SetupWizard />
      </div>
    </div>
  );
}
