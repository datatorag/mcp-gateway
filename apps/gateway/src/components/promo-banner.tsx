"use client";

import { useEffect, useState } from "react";
import posthog from "posthog-js";
import { XIcon } from "lucide-react";
import { EVENTS } from "@/lib/analytics";
import { PROMO, PROMO_DISMISSED_KEY, isPromoCode, promoActive, promoCopy, promoPricingHref } from "@/lib/promo";

/**
 * The promo banner (SCRUM-231): the same words as the running ad, on every
 * public page and, for a signed-in user who is not paying, on the dashboard.
 *
 * Decided on the CLIENT, in an effect, and rendered as nothing on the
 * server: several public pages are prerendered at image build, and a date
 * switch evaluated at build time would freeze the answer into the HTML until
 * the next deploy, which is the "deploy to remove it" the ticket forbids.
 * The cost is one paint without the banner before it appears.
 *
 * Dismissal is a per-browser memory for the campaign's life. A browser with
 * no memory sees the banner, so a first visit from the ad always does, and a
 * visit carrying the code in the URL clears the memory so a click-through
 * from the ad shows it even after an earlier dismissal.
 *
 * One click event carrying the page it was clicked from; nothing on show.
 */
type PromoBannerProps = {
  /** The dashboard variant also needs the plan; it hides for a paying customer. */
  variant?: "public" | "dashboard";
  /** The signed-in user's plan for the dashboard variant; null until known. */
  plan?: string | null;
  /** The clock, injectable for tests. Defaults to the browser's now at mount. */
  now?: Date;
};

/** The URL is read from the window inside the effect, not from Next's
 * navigation hooks: the decision is client-only anyway, it keeps the banner
 * free of a Suspense requirement on prerendered pages, and it keeps every
 * layout test that mounts it free of a navigation mock. */
export function PromoBanner({ variant = "public", plan = null, now }: PromoBannerProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!promoActive(now ?? new Date())) return;
    try {
      const fromAd = isPromoCode(new URLSearchParams(window.location.search).get("promo"));
      if (fromAd) localStorage.removeItem(PROMO_DISMISSED_KEY);
      if (localStorage.getItem(PROMO_DISMISSED_KEY)) return;
    } catch {
      // No storage (a private window that refuses it): show, and forget
      // dismissals, which errs on the side of the campaign.
    }
    setVisible(true);
  }, [now]);

  if (!visible) return null;
  if (variant === "dashboard" && plan !== "free") return null;

  const copy = promoCopy();
  const dismiss = () => {
    try {
      localStorage.setItem(PROMO_DISMISSED_KEY, "1");
    } catch {
      // Same as above: a browser that will not remember still gets to close it.
    }
    setVisible(false);
  };

  return (
    <div
      role="region"
      aria-label="Promotion"
      className={
        variant === "dashboard"
          ? "flex items-center justify-center gap-3 border-b border-primary/20 bg-primary/10 px-4 py-2 text-sm text-foreground"
          : "mx-auto mb-2 flex max-w-6xl items-center justify-center gap-3 rounded-full bg-primary px-4 py-1.5 text-sm text-primary-foreground"
      }
    >
      <a
        href={promoPricingHref()}
        className="font-medium underline-offset-4 hover:underline"
        onClick={() =>
          posthog.capture(EVENTS.PROMO_BANNER_CLICKED, { code: PROMO.code, page: window.location.pathname })
        }
      >
        {copy.headline}
      </a>
      <span className={variant === "dashboard" ? "text-muted-foreground" : "opacity-80"}>{copy.redeemBy}.</span>
      <button
        type="button"
        aria-label="Dismiss"
        className="ml-1 rounded-full p-0.5 opacity-80 hover:opacity-100"
        onClick={dismiss}
      >
        <XIcon aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  );
}
