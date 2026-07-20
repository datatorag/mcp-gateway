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
export function DocsCta({ variant }: { variant: "sidebar" | "mobile" }) {
  const pathname = usePathname();
  const mobile = variant === "mobile";

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
