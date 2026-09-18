"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import posthog from "posthog-js";
import { EVENTS } from "@/lib/analytics";
import { promoActive, promoCopy } from "@/lib/promo";

// Sign-in / get-started CTA rendered on every /docs/* page (SCRUM-24): docs
// are a paid-traffic surface, so a reader must be able to sign up without
// leaving them. The link lands on the dashboard sign-in; first-time signups
// come back to the dashboard with ?signup=1, which fires the SCRUM-5 gtag
// signup conversion — so no extra conversion wiring is needed here. The
// PostHog event is what makes docs-sourced signups attributable per-page.
export function DocsCta({
  variant,
  now,
}: {
  variant: "sidebar" | "mobile" | "inline";
  /** The clock, injectable for tests. Defaults to the browser's now at mount. */
  now?: Date;
}) {
  const pathname = usePathname();
  const mobile = variant === "mobile";

  /* SCRUM-287: on docs the campaign lives INSIDE the sidebar button rather
     than in a banner above the layout, which pushed the sidebar and the
     content down. Decided the way the banner decides it: on the client, in
     an effect, rendered as nothing on the server, because docs pages are
     prerendered and a date switch evaluated at build would freeze the
     answer into the HTML until the next deploy.

     The banner's dismissal memory is deliberately NOT read. This button has
     no dismiss control, so honouring a memory set elsewhere would hide the
     campaign on docs with no way for the reader to bring it back. */
  const [promo, setPromo] = useState(false);
  useEffect(() => {
    setPromo(variant === "sidebar" && promoActive(now ?? new Date()));
  }, [variant, now]);

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

  if (mobile) {
    return (
      <a
        href="/auth/login"
        onClick={() =>
          posthog.capture(EVENTS.DOCS_CTA_CLICKED, {
            cta: "sign_in",
            page: pathname,
          })
        }
        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        Sign in
      </a>
    );
  }

  return (
    <a
      href="/auth/login"
      onClick={() =>
        // `cta` keeps its historical value so the series before and after
        // SCRUM-287 stays comparable; `promo` says which button was clicked.
        posthog.capture(EVENTS.DOCS_CTA_CLICKED, {
          cta: "get_started",
          page: pathname,
          promo,
        })
      }
      className="block rounded-lg bg-primary px-3 py-2 text-center text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
    >
      Get started free
      {promo && (
        <span className="mt-0.5 block text-balance text-xs font-normal leading-snug opacity-90">
          {promoCopy().headline}
        </span>
      )}
    </a>
  );
}
