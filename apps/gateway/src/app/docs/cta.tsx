"use client";

import { usePathname } from "next/navigation";
import posthog from "posthog-js";
import { EVENTS } from "@/lib/analytics";

// Sign-in / get-started CTA rendered on every /docs/* page (SCRUM-24): docs
// are a paid-traffic surface, so a reader must be able to sign up without
// leaving them. The link lands on the dashboard sign-in; first-time signups
// come back to the dashboard with ?signup=1, which fires the SCRUM-5 gtag
// signup conversion — so no extra conversion wiring is needed here. The
// PostHog event is what makes docs-sourced signups attributable per-page.
export function DocsCta({
  variant,
}: {
  variant: "sidebar" | "mobile" | "inline";
}) {
  const pathname = usePathname();
  const mobile = variant === "mobile";

  /* END-OF-PAGE CTA. The sidebar link is chrome: it is present the whole
     time, which is exactly why a reader stops seeing it. This one sits where
     the reader has just finished the page and is at their most convinced,
     and it is the only place on /docs/* that states what signing up gets
     you rather than just offering a door.

     It carries its own `cta` value so it is measurable SEPARATELY from the
     sidebar. Docs already convert well, so an unattributable second CTA
     would destroy the ability to tell whether this one helped, replaced, or
     merely cannibalised the existing click.

     No session read, by the same rule as the layout: cookies() would make
     every docs page dynamic, and docs are a static paid-traffic surface. So
     the copy has to read sanely to a signed-in reader too, which is why it
     says "Open the playground" rather than assuming a stranger. */
  if (variant === "inline") {
    return (
      <div className="mt-12 rounded-xl border border-border bg-secondary/50 p-6">
        <p className="font-display text-lg font-semibold text-foreground">
          Try this on your own account
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Connect Google Workspace once and your assistant can run every tool
          on this page against your real files. Free to start, no card.
        </p>
        <a
          className="mt-4 inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          href="/auth/login"
          onClick={() =>
            posthog.capture(EVENTS.DOCS_CTA_CLICKED, {
              cta: "inline_end",
              page: pathname,
            })
          }
        >
          Get started free
        </a>
      </div>
    );
  }

  return (
    <a
      href="/auth/login"
      onClick={() =>
        posthog.capture(EVENTS.DOCS_CTA_CLICKED, {
          cta: mobile ? "sign_in" : "get_started",
          page: pathname,
        })
      }
      className={`rounded-lg bg-primary font-medium text-primary-foreground transition-opacity hover:opacity-90 ${
        mobile
          ? "px-3 py-1.5 text-xs"
          : "block px-3 py-2 text-center text-sm"
      }`}
    >
      {mobile ? "Sign in" : "Get started free"}
    </a>
  );
}
