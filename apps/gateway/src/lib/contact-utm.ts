import type { Utm } from "@/components/contact-form";

export interface ContactSearchParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  from?: string;
}

// Internal CTAs link with ?from=<page> rather than utm_* params so PostHog's
// automatic campaign attribution on pageviews isn't overwritten by internal
// navigation. Real utm_* params (ad landings) always take precedence, keeping
// ad-driven form fills and site-originated ones separable in the leads table
// and on the lead_submitted event.
export function utmFromSearchParams(params: ContactSearchParams): Utm {
  const internal = params.from ? `${params.from}_page` : undefined;
  return {
    source: params.utm_source ?? internal,
    medium: params.utm_medium ?? (internal ? "internal" : undefined),
    campaign: params.utm_campaign,
    term: params.utm_term,
    content: params.utm_content,
  };
}
