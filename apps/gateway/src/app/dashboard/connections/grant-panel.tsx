"use client";

import posthog from "posthog-js";

import { ServiceIcon } from "@/components/service-icon";
import { EVENTS } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import {
  GRANT_ALL_GRANTED,
  GRANT_AVAILABLE_LABEL,
  GRANT_DISCLOSURE_EMPTY,
  GRANT_DISCLOSURE_LABEL,
  GRANT_NONE_GRANTED,
  GRANT_NOT_GRANTED_LABEL,
  GRANT_PARTIAL_CONSEQUENCE,
  GRANT_RECONNECT_LABEL,
} from "./grant-copy";
import { grantState } from "./grant-state";
import type { ScopeStatus, ServiceGrantState } from "./types";

/**
 * What one connection actually granted, per service (SCRUM-106).
 *
 * ONE COMPONENT, THREE RENDER SITES: the connections page, the per-service
 * detail page, and the agent's inline card. The same reason `ConnectPart` is
 * shared between the thread and the empty state (SCRUM-78) applies with more
 * force here, because the whole feature is a claim about access and two
 * surfaces making that claim differently is the bug, not a cosmetic drift.
 *
 * THE LAYOUT RULE THAT MATTERS, and it is the one thing not to "simplify"
 * away: an EMPTY GROUP BECOMES A SENTENCE. Both degenerate cases fall out of
 * that single rule with no per-case branch and no threshold. Everything
 * granted, so the not-granted group is empty, collapses to one line. Nothing
 * granted, so the available group is empty, also collapses to one line.
 *
 * That second case is the common one (per HQ decision, see SCRUM-106), and it
 * is why chips rather than rows. A row per service turns the most frequent
 * state into eight identical failures stacked down the card, which reads as
 * the product being broken rather than as one consent setting being off. It
 * also does not fit a 390px viewport without scrolling past the control that
 * fixes it. Chips wrap; the all-declined case never renders eight of anything.
 *
 * ONE CONTROL PER CONNECTION, NEVER ONE PER MISSING SERVICE. They would all
 * point at the same consent URL anyway, and eight buttons to fix the
 * commonest state is the opposite of the one-click requirement.
 */
export function GrantPanel({
  scopeStatus,
  rawScopes,
  connectUrl,
  service,
  isConnected = true,
  density = "full",
  reassureWhenComplete = false,
  source,
  nextPath,
  className,
}: {
  scopeStatus: ScopeStatus | undefined;
  /** The stored granted-scopes string, for the disclosure only. Never
   * rendered outside it. */
  rawScopes?: string | null;
  /** The service's connect route. Absent means no control is offered. */
  connectUrl: string | null;
  /** Registry id of the service, for the click event. A prop rather than a
   * constant: only Google has a per-scope opt-out today, so this panel only
   * ever renders for it, and a hardcoded id would be a quiet lie the moment
   * that stops being true. */
  service: string;
  isConnected?: boolean;
  density?: "full" | "compact";
  /** Say so when everything IS granted. Off by default: next to a card whose
   * badge already reads "Connected" the line is redundant, and it would add a
   * row to every healthy user's card to tell them nothing. On for the
   * per-service detail page, which is an audit view, where the absence of a
   * warning is not the same as a positive confirmation. */
  reassureWhenComplete?: boolean;
  /** Which surface this render is, for the SCRUM-112 click series. The two
   * agent values are the ones `ConnectPart` already emits, reused rather than
   * replaced: this panel takes over that card's control on a short grant, and
   * inventing a new source there would split one series in half at a deploy
   * for no analytical gain. */
  source:
    | "connections_page"
    | "service_detail"
    | "thread"
    | "empty_state";
  /** Where the consent round trip should return to. Composed at render time,
   * never stored, for the reason recorded in `agent-parts.tsx`. */
  nextPath?: string | null;
  className?: string;
}) {
  const state = grantState(scopeStatus, isConnected);

  // Nothing to say when the connection is absent or whole: the card's own
  // badge already carries "Connected", and a panel repeating it is noise on
  // the surface of every healthy user.
  if (state === "disconnected") return null;
  if (state === "complete") {
    if (density === "compact" || !reassureWhenComplete) return null;
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        {GRANT_ALL_GRANTED}
      </p>
    );
  }

  const services = scopeStatus?.services ?? [];
  const available = services.filter((s) => s.granted);
  const notGranted = services.filter((s) => !s.granted);
  const compact = density === "compact";

  const href =
    connectUrl && nextPath
      ? `${connectUrl}?next=${encodeURIComponent(nextPath)}`
      : connectUrl;

  return (
    <div className={cn("space-y-3 text-xs", className)}>
      {state === "none" ? (
        // No chips. There is nothing informative to enumerate when the answer
        // is "none of them", and the sentence IS the whole story.
        <p className="text-muted-foreground">{GRANT_NONE_GRANTED}</p>
      ) : (
        <>
          {/* Available first: what DOES work leads, so a partial grant does
              not read as a total failure. */}
          {!compact && available.length > 0 && (
            <ChipGroup label={GRANT_AVAILABLE_LABEL} services={available} />
          )}
          {notGranted.length > 0 && (
            <div className="space-y-1.5">
              <ChipGroup
                label={GRANT_NOT_GRANTED_LABEL}
                services={notGranted}
                muted
              />
              <p className="text-muted-foreground">
                {GRANT_PARTIAL_CONSEQUENCE}
              </p>
            </div>
          )}
        </>
      )}

      {href && (
        // A PLAIN ANCHOR, NOT next/link: these are Express OAuth routes, and
        // Link prefetches them with an `_rsc` param into a cross-origin CORS
        // failure. Same reasoning as the connect buttons in `agent-parts.tsx`.
        <a
          href={href}
          onClick={() =>
            posthog.capture(EVENTS.CONNECT_CARD_CLICKED, {
              service,
              source,
            })
          }
          className="inline-flex w-full items-center justify-center rounded-[var(--radius)] border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning transition-colors hover:bg-warning/20 sm:w-auto"
        >
          {GRANT_RECONNECT_LABEL}
        </a>
      )}

      {/* Raw scopes, closed by default (per HQ decision, see SCRUM-106).
          Scope URLs never render until a person asks for them. */}
      {!compact && (
        <details className="group">
          <summary className="cursor-pointer list-none text-muted-foreground underline-offset-4 hover:underline">
            {GRANT_DISCLOSURE_LABEL}
          </summary>
          <ul className="mt-2 space-y-1 break-all font-mono text-[11px] text-muted-foreground">
            {(rawScopes ?? "")
              .split(/\s+/)
              .filter(Boolean)
              .map((scope) => (
                <li key={scope}>{scope}</li>
              ))}
            {!rawScopes?.trim() && <li>{GRANT_DISCLOSURE_EMPTY}</li>}
          </ul>
        </details>
      )}
    </div>
  );
}

/** A labelled row of service chips. Every chip carries its brand mark, per the
 * standing rule (SCRUM-97): this surface is literally a list of company names,
 * which is exactly what that rule is about. Mark PLUS label, never mark alone.
 *
 * `flex-wrap` is what makes the 390px case work without a media query: eight
 * chips reflow to three or four lines instead of forcing a horizontal
 * scroll. */
function ChipGroup({
  label,
  services,
  muted = false,
}: {
  label: string;
  services: ServiceGrantState[];
  muted?: boolean;
}) {
  return (
    <div>
      <p className="mb-1.5 font-medium text-muted-foreground">{label}</p>
      <ul className="flex flex-wrap gap-1.5">
        {services.map((s) => (
          <li
            key={s.iconKey}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-1",
              muted
                ? "border-border bg-muted/40 text-muted-foreground"
                : "border-border bg-secondary/60 text-foreground"
            )}
          >
            <ServiceIcon
              service={s.iconKey}
              size={14}
              // Not-granted marks are dimmed rather than swapped for a grey
              // glyph: the vendors' guidelines forbid recolouring the marks,
              // and opacity is a property of the tile, not of the artwork.
              className={muted ? "opacity-50" : undefined}
            />
            {s.displayName}
          </li>
        ))}
      </ul>
    </div>
  );
}
