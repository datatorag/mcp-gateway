"use client";

import { useEffect } from "react";
import { reportSignupConversion } from "@/components/google-ads";

/**
 * Fire the Google Ads signup conversion once, then strip the param.
 *
 * Extracted because the post-login destination for a NEW user moved from the
 * dashboard to the Agent, and this effect lived only on the dashboard. Moving
 * the landing page without moving this would have silently stopped reporting
 * every new signup to Ads, with nothing failing and nothing to notice: the
 * conversion just stops arriving.
 *
 * gtag lives in the browser, not in the OAuth callback, which is why the
 * callback hands over a query param instead of reporting it server-side.
 * Stripping the param afterwards keeps a refresh, or a shared URL, from
 * re-firing it.
 */
export function useSignupConversion(): void {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("signup") !== "1") return;
    reportSignupConversion();
    params.delete("signup");
    const rest = params.toString();
    window.history.replaceState(
      null,
      "",
      rest ? `${window.location.pathname}?${rest}` : window.location.pathname
    );
  }, []);
}
