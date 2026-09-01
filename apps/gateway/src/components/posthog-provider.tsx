"use client";

import { useEffect } from "react";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useCurrentUser } from "@/lib/use-current-user";
import { AttributionLinks } from "@/components/attribution-links";

// Init at module scope so posthog is ready before any component effect runs.
// posthog.capture() and .identify() calls will no longer race with init.
//
// SCRUM-194: events route through our reverse proxy (first-party domain, so
// ad blockers no longer drop them — a metric-era boundary, recovered
// measurement rather than growth), and the SDK's dated defaults bundle
// captures pageviews itself via the History API ("history_change"), which is
// what the App Router drives; the hand-rolled route-change tracker is gone.
// One consequence carried from that deletion: $current_url now includes
// #anchors (the old tracker rebuilt the URL without the hash). Page
// breakdowns key on $pathname and are unaffected.
//
// The explicit options below are CLAIMS of deviation from the defaults —
// anything merely restating a default was removed, verified against the
// installed bundle's source (not its docs or types, which do not record what
// `defaults` contains):
//  - capture_performance: neither the base defaults nor the 2026-05-30
//    bundle set it, so web vitals capture is a real deviation and stays.
//  - autocapture: the bundle does not set it (the base default is already
//    true, so this line restates base; kept per the ticket's rule — remove
//    only what the BUNDLE sets).
//  - person_profiles: part of the ruled target config, per SCRUM-194.
// Removed as bundle/base-covered: capture_pageview:false (bundle sets
// "history_change"), capture_pageleave:true (base default follows pageview
// capture).
if (typeof window !== "undefined") {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (key) {
    posthog.init(key, {
      api_host: "https://f.datatorag.com",
      // Required with a proxy: the toolbar and view-in-PostHog links resolve
      // against the real UI origin, not the ingest domain.
      ui_host: "https://us.posthog.com",
      defaults: "2026-05-30",
      capture_performance: { web_vitals: true },
      autocapture: true,
      person_profiles: "identified_only",
    });
  }
}

function IdentifyUser() {
  const user = useCurrentUser();

  useEffect(() => {
    if (!user) return;
    posthog.identify(user.id, {
      email: user.email,
      name: user.name ?? undefined,
    });
  }, [user]);

  return null;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  return (
    <PHProvider client={posthog}>
      <IdentifyUser />
      <AttributionLinks />
      {children}
    </PHProvider>
  );
}
