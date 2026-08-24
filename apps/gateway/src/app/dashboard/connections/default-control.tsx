"use client";

import { useState } from "react";
import posthog from "posthog-js";

import { EVENTS } from "@/lib/analytics";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  SET_DEFAULT_CANCEL_LABEL,
  SET_DEFAULT_CONFIRM_LABEL,
  SET_DEFAULT_CONSEQUENCE,
  SET_DEFAULT_ERROR,
  SET_DEFAULT_LABEL,
  setDefaultConfirm,
  suggestDefaultLine,
  SUGGEST_DEFAULT_ACTION,
} from "./grant-copy";
import { suggestBetterDefault } from "./grant-state";
import type { ConnectedAccount } from "./types";

/**
 * The control that moves `is_default` (SCRUM-147) — which account every tool
 * call with no account named runs as, writes included.
 *
 * ONE COMPONENT, BOTH RENDER SITES (the connections overview and the service
 * detail page), for the same reason `GrantPanel` is shared: two surfaces
 * offering the same account change differently is the bug.
 *
 * WHY A CONFIRMATION STEP: the change is one click, silent, and wrong-until-
 * noticed in exactly the way this subsystem's defects have all been — the
 * product keeps working, just as a different identity. The step names the
 * account and the consequence, then writes. It expands IN FLOW rather than in
 * a popover: the dashboard's `main` clips inline floating elements, so
 * anything overlaid here would have to be portaled, and a control that must
 * never be half-visible is exactly the one not to gamble on that.
 *
 * A failed write says so and changes nothing client-side; state is re-fetched
 * from the server after success rather than mirrored optimistically, so the
 * badge the user sees next is the row the resolver will actually use.
 */
export function SetDefaultControl({
  accountId,
  accountEmail,
  service,
  source,
  label = SET_DEFAULT_LABEL,
  onChanged,
}: {
  accountId: string;
  accountEmail: string;
  /** Connector id, for the analytics event only. */
  service?: string;
  /** Which surface offered the control, for the analytics event only. */
  source?: string;
  /** The trigger's label; the confirmation step is the same either way. */
  label?: string;
  /** Called after a CONFIRMED, SUCCESSFUL write — re-fetch from the server. */
  onChanged: () => void | Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/connections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, setDefault: true }),
      });
      if (!res.ok) throw new Error(String(res.status));
      posthog.capture(EVENTS.DEFAULT_ACCOUNT_CHANGED, { service, source });
      setConfirming(false);
      await onChanged();
    } catch {
      setError(SET_DEFAULT_ERROR);
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <Button
        variant="outline"
        size="xs"
        className="text-muted-foreground"
        onClick={() => {
          setConfirming(true);
          setError(null);
        }}
      >
        {label}
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-foreground">
        {setDefaultConfirm(accountEmail)}{" "}
        <span className="text-muted-foreground">{SET_DEFAULT_CONSEQUENCE}</span>
      </span>
      <Button variant="outline" size="xs" onClick={apply} disabled={busy}>
        {busy ? "..." : SET_DEFAULT_CONFIRM_LABEL}
      </Button>
      <Button
        variant="ghost"
        size="xs"
        onClick={() => setConfirming(false)}
        disabled={busy}
      >
        {SET_DEFAULT_CANCEL_LABEL}
      </Button>
      {error && <span className="text-warning">{error}</span>}
    </div>
  );
}

/**
 * The SCRUM-145 escape hatch, surfaced (SCRUM-147): when the default account
 * granted nothing and a sibling holds the recorded full grant, switching
 * beats re-consenting — this is the population the scope refusal now points
 * here. `suggestBetterDefault` owns the rule; this renders nothing when it
 * declines, so neither surface has to re-derive the boundary cases.
 */
export function BetterDefaultSuggestion({
  accounts,
  service,
  source,
  onChanged,
  className,
}: {
  accounts: ConnectedAccount[];
  service?: string;
  source?: string;
  onChanged: () => void | Promise<void>;
  className?: string;
}) {
  const suggestion = suggestBetterDefault(accounts);
  if (!suggestion) return null;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs",
        className
      )}
    >
      <span className="text-foreground">
        {suggestDefaultLine(suggestion.accountEmail)}
      </span>
      <SetDefaultControl
        accountId={suggestion.id}
        accountEmail={suggestion.accountEmail}
        service={service}
        source={source}
        label={SUGGEST_DEFAULT_ACTION}
        onChanged={onChanged}
      />
    </div>
  );
}
