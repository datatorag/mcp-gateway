"use client";

import { useEffect } from "react";
import posthog from "posthog-js";
import { Button } from "@/components/ui/button";

const DASHBOARD_ERROR_TITLE = "This page hit an error.";
const DASHBOARD_ERROR_BODY =
  "Nothing you did was lost. Try the page again, or reload it if that does not help.";

/**
 * The dashboard's own error page.
 *
 * Without one, a throw anywhere under /dashboard fell through to the
 * framework's root screen, which replaces the entire document. This renders
 * INSIDE the dashboard layout instead, so the navigation stays and the user
 * has somewhere to go besides the back button.
 *
 * Two ways out, because they are different repairs. "Try again" re-renders
 * the segment, which is enough for a fault in the data. "Reload" is a full
 * load, which is what clears a fault in the document itself (a stale bundle
 * after a release, or a page another program has rewritten).
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    try {
      posthog.captureException(error, { boundary: "dashboard" });
    } catch {
      // Telemetry is best-effort.
    }
  }, [error]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-muted/40 p-5 text-sm"
        data-testid="dashboard-error"
        role="alert"
      >
        <p className="font-medium text-foreground">{DASHBOARD_ERROR_TITLE}</p>
        <p className="mt-1.5 text-muted-foreground">{DASHBOARD_ERROR_BODY}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={reset} size="sm">
            Try again
          </Button>
          <Button onClick={() => window.location.reload()} size="sm" variant="outline">
            Reload the page
          </Button>
        </div>
      </div>
    </div>
  );
}
