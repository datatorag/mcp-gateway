"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  APPROVED_APPS_EMPTY,
  APPROVED_APPS_INTRO,
  APPROVED_APPS_TITLE,
  APPROVED_APPS_UNAVAILABLE,
  approvedOn,
  lastTokenOn,
  NAME_UNVERIFIED,
  REMOVE_CANCEL_LABEL,
  REMOVE_CONFIRM_LABEL,
  REMOVE_ERROR,
  REMOVE_LABEL,
  removeConfirm,
  sendsTo,
  UNNAMED_APP,
} from "./approved-apps-copy";

/** One entry of `GET /api/approved-apps` (`ApprovedApp` in
 * `gateway/oauth/approved-apps.ts`; not imported, that module is server code). */
type ApprovedApp = {
  clientId: string;
  name: string | null;
  redirectHosts: string[];
  approvedAt: string | null;
  lastTokenAt: string | null;
};

/**
 * "Apps you approved": the clients this user let use DataToRAG as them, each
 * with a Remove that ends its access and its approval.
 *
 * An app's name is whatever it registered with. It is rendered as a text
 * child and nowhere else, so nothing in it is ever markup, and the row says
 * that the app gave it. Two apps with one name are two rows, each with its
 * own host and dates: merging them would hide a look-alike behind a real one.
 *
 * Remove confirms in flow, as the default-account control on this page does,
 * and the list is read again from the server afterwards instead of edited
 * here, so what the row shows next is what the server holds. The removal's
 * analytics event is sent by the route, once.
 */
export function ApprovedApps() {
  const [apps, setApps] = useState<ApprovedApp[] | null>(null);
  const [failed, setFailed] = useState(false);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/approved-apps");
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { apps?: ApprovedApp[] };
      setApps(Array.isArray(data.apps) ? data.apps : []);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return (
    <section className="mt-10" data-approved-apps="">
      <h2 className="font-display text-base font-bold text-foreground">
        {APPROVED_APPS_TITLE}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{APPROVED_APPS_INTRO}</p>

      {apps === null ? (
        failed ? (
          <p className="mt-4 text-sm text-muted-foreground">{APPROVED_APPS_UNAVAILABLE}</p>
        ) : (
          <Card className="mt-4">
            <CardContent className="space-y-2">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-56 max-w-full" />
            </CardContent>
          </Card>
        )
      ) : apps.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{APPROVED_APPS_EMPTY}</p>
      ) : (
        <Card className="mt-4">
          <CardContent className="space-y-4">
            {apps.map((app) => (
              <ApprovedAppRow key={app.clientId} app={app} onRemoved={refetch} />
            ))}
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function ApprovedAppRow({
  app,
  onRemoved,
}: {
  app: ApprovedApp;
  onRemoved: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hosts = sendsTo(app.redirectHosts);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/approved-apps?clientId=${encodeURIComponent(app.clientId)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(String(res.status));
      await onRemoved();
      setConfirming(false);
    } catch {
      setError(REMOVE_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2" data-approved-app="">
      <div className="flex flex-wrap items-start justify-between gap-2">
        {/* min-w-0 and anywhere-wrapping: a name or a host is one long
            unbroken string as often as not, and must never push the row
            wider than a phone. */}
        <div className="min-w-0 flex-1 basis-56 space-y-0.5 [overflow-wrap:anywhere]">
          <p className="text-sm font-medium text-foreground" data-approved-app-name="">
            {app.name ?? UNNAMED_APP}
          </p>
          {app.name !== null && (
            <p className="text-[11px] text-muted-foreground">{NAME_UNVERIFIED}</p>
          )}
          {hosts !== "" && <p className="text-xs text-muted-foreground">{hosts}</p>}
          <p className="text-xs text-muted-foreground">
            <span>{approvedOn(app.approvedAt)}</span>
            <span aria-hidden="true">{" · "}</span>
            <span>{lastTokenOn(app.lastTokenAt)}</span>
          </p>
        </div>
        {!confirming && (
          <Button
            variant="ghost"
            size="xs"
            className="shrink-0 text-muted-foreground"
            onClick={() => {
              setConfirming(true);
              setError(null);
            }}
          >
            <span>{REMOVE_LABEL}</span>
          </Button>
        )}
      </div>
      {confirming && (
        <div className="flex flex-wrap items-center gap-2 text-xs [overflow-wrap:anywhere]">
          <span className="min-w-0 text-foreground">{removeConfirm(app.name)}</span>
          <Button variant="outline" size="xs" onClick={remove} disabled={busy}>
            <span>{busy ? "..." : REMOVE_CONFIRM_LABEL}</span>
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setConfirming(false)} disabled={busy}>
            <span>{REMOVE_CANCEL_LABEL}</span>
          </Button>
          {error && <span className="text-warning">{error}</span>}
        </div>
      )}
    </div>
  );
}
