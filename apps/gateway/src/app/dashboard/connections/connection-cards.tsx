"use client";

import { useState } from "react";
import Link from "next/link";
import posthog from "posthog-js";
import { EVENTS } from "@/lib/analytics";
import { ServiceIcon } from "@/components/service-icon";
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
import { SERVICE_CARD_TOOLS_LABEL } from "../agent-composer-copy";
import { ConnectHelper, NotionConnectHelper } from "../connect-helper";
import type { useConnections } from "../use-connections";
import { SERVICES } from "./services";
import { offeredServices } from "./service-registry";
import type { ConnectedAccount } from "./types";
import { GrantPanel } from "./grant-panel";
import { BetterDefaultSuggestion, SetDefaultControl } from "./default-control";
import {
  GRANT_STATE_LABEL,
  GRANT_STATE_VARIANT,
  grantState,
  type GrantState,
} from "./grant-state";
import { accountDisplay, accountName } from "./account-display";

/**
 * The connection card list: one card per offered service, its accounts, and
 * connect, add-account and disconnect (SCRUM-482 moved it here from the
 * dashboard home, unchanged, so `/dashboard/connections` can render it).
 *
 * The caller owns the connection state (`useConnections`) and passes it in,
 * so a page that also reads that state (the home's status strip) does not
 * fetch it twice.
 */
export function ConnectionCards({
  connections,
}: {
  connections: ReturnType<typeof useConnections>;
}) {
  const {
    accounts,
    legacyConnections,
    setAccounts,
    setLegacyConnections,
    loaded,
    refetch,
    launchedServices,
  } = connections;
  const loading = !loaded;
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

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
    <>
      {/* Service cards */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2" data-connection-cards="">
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
          // SCRUM-366: a service whose plugin has not launched gets no card.
          offeredServices(SERVICES, launchedServices).map((service) => {
            const serviceAccounts = accounts.filter(
              (a) => a.connectorType === service.id
            );
            const legacyConn = legacyConnections.find(
              (c) => c.service === service.id
            );
            const hasAccounts = serviceAccounts.length > 0;
            const isConnected = hasAccounts || !!legacyConn;

            /** SCRUM-106: the card's badge answers "what can this actually
             * do", not "does a row exist". Worst state across the accounts
             * wins, because a card claiming Connected while one of its
             * accounts grants nothing is the same overclaim at a smaller
             * scale. Legacy rows carry their own status and join in. */
            const cardState = ((): GrantState => {
              const states = [
                ...serviceAccounts.map((a) =>
                  grantState(a.scopeStatus, true)
                ),
                ...(legacyConn ? [grantState(legacyConn.scopeStatus, true)] : []),
              ];
              if (states.length === 0) return "disconnected";
              return (
                (["none", "partial"] as const).find((s) =>
                  states.includes(s)
                ) ?? "complete"
              );
            })();

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
                    <Badge
                      variant={GRANT_STATE_VARIANT[cardState]}
                      className={
                        cardState === "disconnected"
                          ? "text-muted-foreground"
                          : undefined
                      }
                    >
                      <span
                        className={
                          cardState === "disconnected"
                            ? "size-1.5 rounded-full bg-muted-foreground/40"
                            : "size-1.5 rounded-full bg-current"
                        }
                      />
                      {GRANT_STATE_LABEL[cardState]}
                    </Badge>
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
                  <CardContent className="space-y-3 border-t pt-4">
                    {serviceAccounts.map((account) => {
                      // SCRUM-436: a Notion row leads with its workspace
                      // name, the email beneath; every other row is the
                      // email alone, as before.
                      const name = accountDisplay(account);
                      return (
                      <div key={account.id} className="space-y-2" data-account-row="">
                      <div
                        className="flex flex-wrap items-center justify-between gap-2"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-medium text-primary">
                            {[...name.primary][0].toUpperCase()}
                          </div>
                          {name.secondary ? (
                            <span className="flex min-w-0 flex-col">
                              <span
                                className="truncate text-xs text-foreground"
                                data-account-primary=""
                              >
                                {name.primary}
                              </span>
                              <span
                                className="truncate text-[11px] text-muted-foreground"
                                data-account-secondary=""
                              >
                                {name.secondary}
                              </span>
                            </span>
                          ) : (
                            <span
                              className="truncate text-xs text-foreground"
                              data-account-primary=""
                            >
                              {name.primary}
                            </span>
                          )}
                          {account.isDefault && (
                            <Badge
                              variant="secondary"
                              className="bg-primary/10 text-primary"
                            >
                              Default
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {/* SCRUM-147: the state shown here has to be
                              actionable where it is shown, not one page away. */}
                          {!account.isDefault && serviceAccounts.length > 1 && (
                            <SetDefaultControl
                              accountId={account.id}
                              accountName={accountName(account)}
                              service={service.id}
                              source="connections_page"
                              onChanged={refetch}
                            />
                          )}
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
                      </div>
                      {/* SCRUM-106. Renders nothing for a complete grant (the
                          badge above already carries that), so a healthy
                          account keeps exactly the compact row it had. */}
                      <GrantPanel
                        scopeStatus={account.scopeStatus}
                        rawScopes={account.scopes}
                        connectUrl={service.connectUrl}
                        service={service.id}
                        source="connections_page"
                        nextPath="/dashboard/connections"
                      />
                      {/* SCRUM-147: switching beats re-consenting when a full
                          sibling exists; renders nothing otherwise. */}
                      {account.isDefault && (
                        <BetterDefaultSuggestion
                          accounts={serviceAccounts}
                          service={service.id}
                          source="connections_page"
                          onChanged={refetch}
                        />
                      )}
                      </div>
                      );
                    })}
                  </CardContent>
                )}

                {/* Legacy connection */}
                {!hasAccounts && legacyConn && (
                  <CardContent className="space-y-2 border-t pt-4">
                    <div className="flex items-center justify-between">
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
                    </div>
                    {/* Legacy rows carry a grant too, and a legacy Google row
                        can be just as short as a migrated one. */}
                    <GrantPanel
                      scopeStatus={legacyConn.scopeStatus}
                      rawScopes={legacyConn.scopes}
                      connectUrl={service.connectUrl}
                      service={service.id}
                      source="connections_page"
                      nextPath="/dashboard/connections"
                    />
                  </CardContent>
                )}

                {/* Actions footer. The Google card's connect note sits in it,
                    under the buttons (SCRUM-434): it explains the button above
                    it, so it shares the footer's band and corners rather than
                    hanging below the card as a strip of its own. */}
                <CardFooter className="flex-col items-stretch gap-2">
                  <div className="flex gap-2">
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
                        {SERVICE_CARD_TOOLS_LABEL}
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
                  </div>
                  {/* SCRUM-410: under the Google card's connect button, on
                      every device, until the user hides it. */}
                  {service.id === "google-workspace" && <ConnectHelper />}
                  {/* SCRUM-436: which workspace, and how to reach another
                      Notion login, said where the button that does it is. */}
                  {service.id === "notion" && <NotionConnectHelper />}
                </CardFooter>
              </Card>
            );
          })
        )}
      </div>
    </>
  );
}
