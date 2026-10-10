"use client";

import { useEffect } from "react";
import posthog from "posthog-js";
import {
  ATTRIBUTION_PARAMS,
  type AttributionField,
} from "@/lib/attribution";
import { EVENTS } from "@/lib/analytics";
import { SIGN_IN_PATH } from "@/lib/sign-in";

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

/** The same-origin auth-flow URL this href points at, with the attribution
 * snapshot attached; null for anything else. */
function attributed(href: string): URL | null {
  let url: URL;
  try {
    url = new URL(href, window.location.origin);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  if (!ATTRIBUTED_PATHS.has(url.pathname)) return null;
  for (const [name, value] of Object.entries(snapshot())) {
    url.searchParams.set(name, value);
  }
  return url;
}

/** Marks a sign-in link that has been clicked and is on its way to Google.
 * `globals.css` dims it; the listener below refuses a second click on it. */
const SIGNING_IN = "signingIn";

function reportSignInStarted(url: URL, cta: string | null): void {
  try {
    // Where it was clicked and which button, never where it returns to: a
    // return path can carry a campaign slug, and that already travels on the
    // events that own it.
    posthog.capture(EVENTS.SIGNIN_STARTED, {
      page: window.location.pathname,
      cta,
      has_next: url.searchParams.has("next"),
    });
  } catch {
    // Best-effort, like the snapshot.
  }
}

/**
 * Start sign-in from code instead of from a link: a button that only finds
 * out the visitor is signed out after asking the server (the Pro checkout).
 * Attaches the same snapshot a clicked link gets and reports the same event,
 * then returns the URL to navigate to. Any other URL comes back unchanged.
 */
export function signInDestination(href: string, cta: string | null = null): string {
  const url = attributed(href);
  if (!url || url.pathname !== SIGN_IN_PATH) return href;
  reportSignInStarted(url, cta);
  return url.toString();
}

/**
 * Appends the attribution snapshot to outbound links into the auth flows,
 * and owns the sign-in click (SCRUM-408).
 *
 * Calls to action start Google sign-in directly now, so this listener is the
 * one place every sign-in begins. Three things happen here because here is
 * the only place they can happen for every button at once:
 *
 *  - the attribution snapshot goes on the link, as before;
 *  - `signin_started` is captured, which is what the sign-in funnel starts
 *    from now that the login page is not on the way;
 *  - the link is marked busy and a second click on it is refused. The
 *    redirect to Google takes a moment during which the button used to look
 *    as if nothing had happened, and people clicked it again and again.
 *
 * Rendered once inside the analytics provider; mutating `href` from a
 * capture-phase listener runs before the browser reads it for navigation.
 */
export function AttributionLinks() {
  useEffect(() => {
    function onClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      if (!anchor) return;
      const url = attributed(anchor.href);
      if (!url) return;
      anchor.href = url.toString();
      if (url.pathname !== SIGN_IN_PATH) return;

      if (anchor.dataset[SIGNING_IN] !== undefined) {
        event.preventDefault();
        return;
      }
      reportSignInStarted(url, anchor.dataset.cta ?? null);
      // Only a plain click leaves this page. A new tab or window keeps the
      // page, and a button stuck busy on a page that is still here is dead.
      const leavesThisPage =
        event.button === 0 &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        (anchor.target === "" || anchor.target === "_self");
      if (leavesThisPage) {
        anchor.dataset[SIGNING_IN] = "";
        anchor.setAttribute("aria-busy", "true");
      }
    }
    // Coming back with the browser's Back button can restore this page as it
    // was left, busy mark included.
    function onPageShow() {
      for (const anchor of document.querySelectorAll<HTMLAnchorElement>("a[data-signing-in]")) {
        delete anchor.dataset[SIGNING_IN];
        anchor.removeAttribute("aria-busy");
      }
    }
    document.addEventListener("click", onClick, true);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  return null;
}
