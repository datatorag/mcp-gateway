"use client";

import Link from "next/link";
import { CasaBadge } from "@/components/casa-badge";
import { ConnectOutcomeNotice } from "../connect-outcome-notice";
import { useConnections } from "../use-connections";
import { ConnectionCards } from "./connection-cards";

/** `/dashboard/connections` (SCRUM-482): the connection card list, on its own
 * page with its own nav item. It was the dashboard home until the home became
 * the connect-your-client page. */
export function ConnectionsClient() {
  const connections = useConnections();
  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-foreground">
        Connections
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Connect the accounts your agent works with. New here? Read the{" "}
        <Link
          href="/docs/getting-started"
          className="font-medium text-primary hover:underline"
        >
          Getting Started guide
        </Link>
        .
      </p>

      {/* Shown before the consent-screen step the Connect buttons lead to. */}
      <CasaBadge className="mt-4" />

      {/* SCRUM-149: a refused zero-grant connect lands here (the connect
          flow's fallback leg is this path with `error=`) and says so, with
          the retry path, instead of vanishing into the cards. */}
      <ConnectOutcomeNotice />

      <ConnectionCards connections={connections} />
    </div>
  );
}
