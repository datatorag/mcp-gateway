"use client";

import { useEffect } from "react";
import posthog from "posthog-js";
import {
  ATTRIBUTION_PARAMS,
  type AttributionField,
} from "@/lib/attribution";

/**
 * Server-rendered redirect routes whose completion is reported by a
 * server-side event. Those events cannot be attributed without a session id,
 * so we hand ours over on the way in and the callback stamps it back on.
 *
 * These are express routes, not app-router pages, so every link to them is a
 * plain full-page `<a href>`. A delegated listener therefore covers all of
 * them — the login button, the dashboard connect buttons, the per-connector
 * "Add account" links — and covers any link added later for free. Wiring
 * each call site individually would leave the next one silently unattributed.
 */
const ATTRIBUTED_PATHS = new Set([
  "/auth/google",
  "/auth/google/connect",
  "/auth/atlassian/connect",
]);

/**
 * Analytics-SDK persistence keys for the visitor's first-touch entry
 * snapshot, mapped onto our wire fields. `get_initial_props()` derives these
 * from the persisted entry referrer + entry URL, which is what makes them
 * first-touch rather than "whatever page they happen to be on now".
 */
const INITIAL_PROP_KEYS: Partial<Record<AttributionField, string>> = {
  utmSource: "$initial_utm_source",
  utmMedium: "$initial_utm_medium",
  utmCampaign: "$initial_utm_campaign",
  gclid: "$initial_gclid",
  gadSource: "$initial_gad_source",
  referringDomain: "$initial_referring_domain",
  entryUrl: "$initial_current_url",
};

/**
 * Read the current attribution snapshot. Called at click time, never cached:
 * sessions roll over on an idle timeout and at UTC midnight, so a session id
 * captured on mount can be stale by the time someone finishes signing up —
 * and a confidently wrong attribution is worse than a missing one, because
 * nothing flags it.
 */
function snapshot(): Record<string, string> {
  const params: Record<string, string> = {};
  try {
    const sessionId = posthog.get_session_id?.();
    if (sessionId) params[ATTRIBUTION_PARAMS.sessionId] = sessionId;

    const distinctId = posthog.get_distinct_id?.();
    if (distinctId) params[ATTRIBUTION_PARAMS.distinctId] = distinctId;

    const initial = posthog.persistence?.get_initial_props?.() ?? {};
    for (const [field, key] of Object.entries(INITIAL_PROP_KEYS)) {
      const value = initial[key];
      if (typeof value === "string" && value) {
        params[ATTRIBUTION_PARAMS[field as AttributionField]] = value;
      }
    }
  } catch {
    // The SDK may be blocked or uninitialised. Attribution is best-effort:
    // the link still works, the snapshot is just empty.
  }
  return params;
}

function decorate(anchor: HTMLAnchorElement): void {
  let url: URL;
  try {
    url = new URL(anchor.href, window.location.origin);
  } catch {
    return;
  }
  if (url.origin !== window.location.origin) return;
  if (!ATTRIBUTED_PATHS.has(url.pathname)) return;

  for (const [name, value] of Object.entries(snapshot())) {
    url.searchParams.set(name, value);
  }
  anchor.href = url.toString();
}

/**
 * Appends the attribution snapshot to outbound links into the auth flows.
 * Rendered once inside the analytics provider; mutating `href` from a
 * capture-phase listener runs before the browser reads it for navigation.
 */
export function AttributionLinks() {
  useEffect(() => {
    function onClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      if (anchor) decorate(anchor);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
