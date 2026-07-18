"use client";

import { useEffect, Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useCurrentUser } from "@/lib/use-current-user";

// Init at module scope so posthog is ready before any component effect runs.
// usePathname/useSearchParams still need to be inside components, but
// posthog.capture() and .identify() calls will no longer race with init.
if (typeof window !== "undefined") {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (key) {
    posthog.init(key, {
      api_host: "https://us.i.posthog.com",
      capture_pageview: false,
      // Off by default when auto-pageviews are disabled — needed for bounce
      // rate / session duration and Core Web Vitals in Web Analytics.
      capture_pageleave: true,
      capture_performance: { web_vitals: true },
      autocapture: true,
      person_profiles: "identified_only",
    });
  }
}

function PageviewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qs = searchParams?.toString() ?? "";

  useEffect(() => {
    if (!pathname) return;
    const path = qs ? `${pathname}?${qs}` : pathname;
    posthog.capture("$pageview", {
      $current_url: window.location.origin + path,
    });
  }, [pathname, qs]);

  return null;
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
      <Suspense fallback={null}>
        <PageviewTracker />
      </Suspense>
      <IdentifyUser />
      {children}
    </PHProvider>
  );
}
