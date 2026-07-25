"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { SERVICES } from "./services";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatConnectedDate } from "@/lib/utils";
import type { ConnectedAccount, LegacyConnection } from "./types";

export function ConnectionsClient() {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [legacyConnections, setLegacyConnections] = useState<
    LegacyConnection[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

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

  async function disconnectAccount(e: React.MouseEvent, accountId: string) {
    e.preventDefault();
    e.stopPropagation();
    setDisconnecting(accountId);
    await fetch(`/api/connections?accountId=${accountId}`, {
      method: "DELETE",
    });
    setAccounts((prev) => prev.filter((a) => a.id !== accountId));
    setDisconnecting(null);
  }

  async function disconnectLegacy(e: React.MouseEvent, service: string) {
    e.preventDefault();
    e.stopPropagation();
    setDisconnecting(service);
    await fetch(`/api/connections?service=${service}`, { method: "DELETE" });
    setLegacyConnections((prev) => prev.filter((c) => c.service !== service));
    setDisconnecting(null);
  }

  if (loading) {
    return (
      <div className="mt-8 space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Skeleton className="h-10 w-10 rounded-lg" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
              </div>
              <Skeleton className="h-9 w-28 rounded-lg" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-4">
      {SERVICES.map((service) => {
        const serviceAccounts = accounts.filter(
          (a) => a.connectorType === service.id
        );
        const legacyConn = legacyConnections.find(
          (c) => c.service === service.id
        );
        const hasAccounts = serviceAccounts.length > 0;
        const isConnected = hasAccounts || !!legacyConn;

        return (
          <Card
            key={service.id}
            className={
              isConnected ? "transition-colors hover:ring-primary/30" : ""
            }
          >
            <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-4">
                <div className="shrink-0">{service.icon}</div>
                <div>
                  <h3 className="font-display text-base font-semibold text-foreground">
                    {service.name}
                  </h3>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {service.description}
                  </p>
                </div>
              </div>

              <Button
                variant={isConnected ? "outline" : "default"}
                className="self-start sm:self-auto"
                nativeButton={false}
                render={<a href={service.connectUrl} />}
              >
                {isConnected ? "Add account" : "Connect"}
              </Button>
            </CardContent>

            {/* Connected accounts list */}
            {hasAccounts && (
              <CardContent className="space-y-2 border-t pt-4">
                {serviceAccounts.map((account) => (
                  <Link
                    key={account.id}
                    href={`/dashboard/connections/${service.id}`}
                    className="flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors hover:bg-secondary/50"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                        {account.accountEmail[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">
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
                          {account.label && (
                            <Badge variant="secondary">{account.label}</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Connected {formatConnectedDate(account.connectedAt)}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => disconnectAccount(e, account.id)}
                      disabled={disconnecting === account.id}
                      className="text-muted-foreground"
                    >
                      {disconnecting === account.id ? "..." : "Disconnect"}
                    </Button>
                  </Link>
                ))}
              </CardContent>
            )}

            {/* Legacy connection (no connected_accounts row yet) */}
            {!hasAccounts && legacyConn && (
              <CardContent className="flex items-center justify-between border-t pt-4">
                <p className="text-xs text-muted-foreground">
                  Connected {formatConnectedDate(legacyConn.connectedAt)}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => disconnectLegacy(e, service.id)}
                  disabled={disconnecting === service.id}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {disconnecting === service.id ? "..." : "Disconnect"}
                </Button>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
