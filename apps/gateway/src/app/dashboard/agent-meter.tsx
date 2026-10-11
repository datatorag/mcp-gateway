"use client";

import { getConnector } from "@/lib/docs-connectors";
import type { ConnectedAccount } from "./connections/types";

/** What the meter knows about the run allowance. `cap: null` means the
 * account is EXEMPT (runs counted, never refused) — a real state, rendered
 * as its own words, never as 0, NaN, Infinity, or a free-cap fallback. */
export type AgentQuota = {
  used: number;
  cap: number | null;
  remaining: number | null;
};

/** The copy, exported so tests pin words rather than re-deriving them. */
export function runsLabel(quota: AgentQuota | null): string | null {
  if (!quota) return null;
  if (quota.cap === null) {
    // The exempt state: only internal accounts see this. The runs are
    // counted (the number is real) but nothing refuses them, so there is no
    // denominator to print and inventing one would be the lie this ticket
    // warns about.
    return `${quota.used} runs this period, no cap on this account`;
  }
  const remaining = quota.remaining ?? Math.max(0, quota.cap - quota.used);
  return `${remaining} of ${quota.cap} runs left`;
}

/** One connector's display: title plus how many accounts are connected.
 * Multi-account is first-class on every tier, so a count is shown whenever
 * it exceeds one, and the emails ride on a native title tooltip (browser
 * drawn, so the clipping `main` cannot cut it off — nothing to portal). */
function connectorSummaries(accounts: ConnectedAccount[]) {
  const byType = new Map<string, ConnectedAccount[]>();
  for (const account of accounts) {
    const list = byType.get(account.connectorType) ?? [];
    list.push(account);
    byType.set(account.connectorType, list);
  }
  return Array.from(byType.entries()).map(([type, list]) => ({
    key: type,
    label:
      (getConnector(type)?.title ?? type) + (list.length > 1 ? ` x${list.length}` : ""),
    emails: list.map((a) => a.accountEmail).join(", "),
  }));
}

/**
 * The glanceable strip in the chat panel (SCRUM-94): which connectors are
 * connected, and the agent-run allowance. One muted line, no controls — it
 * informs the conversation without competing with it, and it deliberately
 * says nothing about TOOL CALLS (Pro's call allowance has no hard stop, and
 * a meter that mixed the two would imply one).
 */
export function AgentMeter({
  quota,
  accounts,
  accountsLoaded,
}: {
  quota: AgentQuota | null;
  accounts: ConnectedAccount[];
  accountsLoaded: boolean;
}) {
  const runs = runsLabel(quota);
  const connectors = connectorSummaries(accounts);

  // Nothing to say yet: stay out of the way rather than flashing skeletons
  // under the composer.
  if (!runs && !accountsLoaded) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 text-[11px] text-muted-foreground">
      <span className="flex flex-wrap items-center gap-x-2">
        {accountsLoaded && connectors.length === 0 && (
          <span>No connectors connected</span>
        )}
        {connectors.map((c) => (
          <span key={c.key} title={c.emails}>
            {c.label}
          </span>
        ))}
      </span>
      {runs && <span className="tabular-nums">{runs}</span>}
    </div>
  );
}
