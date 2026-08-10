"use client";

import { useCallback, useEffect, useState } from "react";
import type { ConnectedAccount, LegacyConnection } from "./connections/types";

/**
 * Which accounts this user has connected.
 *
 * Shared because the same state now backs two destinations, and the copies had
 * ALREADY diverged before they were a day old: one grew a refetch the other
 * did not, so the same user connecting an account saw it reflected on one
 * screen and not the other. That is the failure this file exists to prevent,
 * and it is the same reason the prompts list and the signup conversion were
 * pulled out next door.
 */
export function useConnections() {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [legacyConnections, setLegacyConnections] = useState<LegacyConnection[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refetch = useCallback(async () => {
    // `loaded` must be set on EVERY path, including a rejected fetch. It was
    // set only after the await, so a network failure threw past it and left
    // the flag false forever - and any surface gated on that flag rendered
    // nothing at all. A failed account lookup means "we do not know what is
    // connected", which is the same state as none connected, not a reason to
    // withhold the page.
    try {
      const res = await fetch("/api/connections");
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts ?? []);
        setLegacyConnections(data.connections ?? []);
      }
    } catch (err) {
      // STATUS ONLY, NEVER THE BODY. A silent catch here is what turned a
      // transient failure into a rollback and a manual production diagnosis:
      // the page rendered, nothing errored anywhere we could see, and the
      // cause was invisible in telemetry. A breadcrumb means the next one
      // reports itself.
      //
      // The response body is deliberately not touched - it carries the user's
      // connected accounts and email addresses, and a log line is the wrong
      // place for either.
      console.warn(
        "[connections] lookup failed, treating as none connected:",
        err instanceof Error ? err.name : "unknown"
      );
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return {
    accounts,
    legacyConnections,
    setAccounts,
    setLegacyConnections,
    loaded,
    refetch,
    hasConnectedAccount: accounts.length > 0 || legacyConnections.length > 0,
  };
}
