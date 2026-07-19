import Script from "next/script";

// Google Ads global site tag (gtag.js). Public client-side ID — safe to ship.
const GOOGLE_ADS_ID = "AW-18240284968";

// Conversion labels from the Google Ads conversion actions
// (Goals → Conversions → the action's tag setup, e.g. "AbC-dEfG12345").
// Set the NEXT_PUBLIC_* vars in prod once each action exists.
const LEAD_CONVERSION_LABEL = process.env.NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL;
const SIGNUP_CONVERSION_LABEL =
  process.env.NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_CONVERSION_LABEL;

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

function reportConversion(label: string | undefined) {
  if (typeof window === "undefined") return;
  if (!label) return;
  if (typeof window.gtag !== "function") return;
  window.gtag("event", "conversion", {
    send_to: `${GOOGLE_ADS_ID}/${label}`,
  });
}

/**
 * Fires a Google Ads conversion for a completed lead submission.
 * No-ops if gtag hasn't loaded (dev / not yet live) or the conversion
 * label isn't configured yet.
 */
export function reportLeadConversion() {
  reportConversion(LEAD_CONVERSION_LABEL);
}

/**
 * Fires a Google Ads conversion for a new account signup. Called from the
 * dashboard when it loads with ?signup=1 (set by the OAuth callback for
 * first-time users). Same no-op guards as the lead conversion.
 */
export function reportSignupConversion() {
  reportConversion(SIGNUP_CONVERSION_LABEL);
}

/**
 * Loads the Google Ads global tag site-wide. Rendered from the root layout.
 * Production-only so local dev / preview traffic doesn't pollute conversion data.
 */
export function GoogleAds() {
  if (process.env.NODE_ENV !== "production") return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}`}
        strategy="afterInteractive"
      />
      <Script id="google-ads-gtag" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GOOGLE_ADS_ID}');
        `}
      </Script>
    </>
  );
}
