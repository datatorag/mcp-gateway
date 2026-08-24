"use client";

import { useEffect, useState } from "react";

import { CONNECT_ERROR_NO_SERVICES } from "@/gateway/post-connect-destination";
import { CONNECT_RETRY_LABEL, CONNECT_ZERO_GRANT_NOTICE } from "./agent-connect-copy";
import { CONNECTABLE_SERVICES } from "./connections/service-registry";

/**
 * The dashboard's rendering of a refused connect (SCRUM-149).
 *
 * Scoped to the ZERO-GRANT code deliberately: that is the outcome with a
 * specific, teachable fix (tick the boxes), and the one this ticket exists to
 * stop disguising. Other connect_error codes keep their pre-existing
 * dashboard behaviour (nothing renders here; the agent page has its own
 * notice) rather than gaining a generic banner as a side effect — a message
 * for every code is its own design decision.
 *
 * The params are read once and stripped (same pattern as the agent page), so
 * a reload or a shared URL does not resurrect the banner. Window access lives
 * in the effect because this component is also server-rendered.
 */
export function ConnectOutcomeNotice() {
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // `connect_error` on the requested-path leg, legacy `error` on the
    // fallback leg — one refusal, two spellings (see postConnectDestination).
    const code = params.get("connect_error") ?? params.get("error");
    if (!code) return;
    if (code === CONNECT_ERROR_NO_SERVICES) setRefused(true);
    params.delete("connect_error");
    params.delete("error");
    const rest = params.toString();
    window.history.replaceState(
      null,
      "",
      rest
        ? `${window.location.pathname}?${rest}`
        : window.location.pathname
    );
  }, []);

  if (!refused) return null;

  const google = CONNECTABLE_SERVICES.find(
    (s) => s.id === "google-workspace"
  );

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground">
      <p className="min-w-0 flex-1 basis-64">{CONNECT_ZERO_GRANT_NOTICE}</p>
      {google && (
        // A plain anchor, not next/link: the connect route is an Express OAuth
        // route, and Link prefetches it (same rule as GrantPanel).
        <a
          href={google.connectUrl}
          className="shrink-0 rounded-[var(--radius)] border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning transition-colors hover:bg-warning/20"
        >
          {CONNECT_RETRY_LABEL}
        </a>
      )}
    </div>
  );
}
