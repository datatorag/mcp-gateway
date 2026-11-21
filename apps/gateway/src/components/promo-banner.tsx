"use client";

import { useEffect, useState } from "react";
import posthog from "posthog-js";
import { XIcon } from "lucide-react";
import { EVENTS } from "@/lib/analytics";
import { PROMO, PROMO_DISMISSED_KEY, isPromoCode, promoActive, promoCopy, promoPricingHref } from "@/lib/promo";
import { cn } from "@/lib/utils";

/**
 * The promo (SCRUM-231), in the places it is shown: a small chip above the
 * home page's headline and the pricing page's heading, and a thin bar on the
 * dashboard for a signed-in user who is not paying. All say the same words as the running ad, read
 * from lib/promo.ts.
 *
 * It used to be a wide bar in the navbar of every public page; on a phone
 * that was two lines the full width of the screen above the nav. The chip is
 * one line at every width and is in the page, not the header.
 *
 * Decided on the CLIENT, in an effect, and rendered as nothing on the
 * server: several public pages are prerendered at image build, and a date
 * switch evaluated at build time would freeze the answer into the HTML until
 * the next deploy, which is the "deploy to remove it" the ticket forbids.
 * The cost is one paint without it before it appears.
 *
 * Dismissal is a per-browser memory for the campaign's life. The dashboard
 * bar has the button; the chip has none (it is small enough to leave), and
 * honors the memory, so a browser that closed the old banner or the bar does
 * not get the chip either. A browser with no memory sees it, so a first
 * visit from the ad always does, and a visit carrying the code in the URL
 * clears the memory so a click-through from the ad shows it even after an
 * earlier dismissal.
 *
 * One click event carrying the page it was clicked from; nothing on show.
 */

/** Whether to show the promo in this browser now, and how to dismiss it.
 * The URL is read from the window inside the effect, not from Next's
 * navigation hooks: the decision is client-only anyway, it keeps the promo
 * free of a Suspense requirement on prerendered pages, and it keeps every
 * layout test that mounts it free of a navigation mock. */
function usePromo(now: Date | undefined): { visible: boolean; dismiss: () => void } {
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

  const dismiss = () => {
    try {
      localStorage.setItem(PROMO_DISMISSED_KEY, "1");
    } catch {
      // Same as above: a browser that will not remember still gets to close it.
    }
    setVisible(false);
  };
  return { visible, dismiss };
}

const reportClick = () => posthog.capture(EVENTS.PROMO_BANNER_CLICKED, { code: PROMO.code, page: window.location.pathname });

/**
 * The chip: one line at every width. From `sm` it says both windows, as the
 * banner did; under `sm` the short form, which fits a 320px screen. `tone` is
 * the ground it sits on: the dark hero, or a light page.
 *
 * One link, to pricing with the code in the URL: that is where the code is
 * redeemed, because the pricing page passes it to checkout and says so on
 * the Pro card. On the pricing page itself the same link applies the code to
 * the page the reader is on.
 */
export function PromoChip({ now, tone = "dark" }: { now?: Date; tone?: "dark" | "light" }) {
  const { visible } = usePromo(now);
  if (!visible) return null;
  const copy = promoCopy();
  return (
    <a
      href={promoPricingHref()}
      onClick={reportClick}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-3 py-1 text-[13px] leading-5 transition-colors",
        tone === "dark"
          ? "border-white/20 bg-white/10 text-white/90 hover:bg-white/15"
          : "border-border bg-secondary/60 text-foreground hover:bg-secondary"
      )}
    >
      <span className="sm:hidden">{copy.short}</span>
      <span className="hidden sm:inline">
        <span className="font-medium">{copy.headline}</span>
        <span className="opacity-80"> · {copy.redeemBy}</span>
      </span>
    </a>
  );
}

type PromoBannerProps = {
  /** The signed-in user's plan; null until known. It hides for a paying customer. */
  plan: string | null;
  /** The clock, injectable for tests. Defaults to the browser's now at mount. */
  now?: Date;
};

/** The dashboard's bar, for a signed-in user on the free plan. */
export function PromoBanner({ plan, now }: PromoBannerProps) {
  const { visible, dismiss } = usePromo(now);
  if (!visible || plan !== "free") return null;
  const copy = promoCopy();

  return (
    <div
      role="region"
      aria-label="Promotion"
      className="flex items-center justify-center gap-3 border-b border-primary/20 bg-primary/10 px-4 py-2 text-sm text-foreground"
    >
      <a href={promoPricingHref()} className="font-medium underline-offset-4 hover:underline" onClick={reportClick}>
        {/* One line at every width: the short form on a phone, as on the chip. */}
        <span className="sm:hidden">{copy.short}</span>
        <span className="hidden sm:inline">{copy.headline}</span>
      </a>
      <span className="hidden text-muted-foreground sm:inline">{copy.redeemBy}.</span>
      <button
        type="button"
        aria-label="Dismiss"
        // A 30px target (the 14px icon and its padding) without making the bar taller.
        className="-my-1.5 -ml-1 rounded-full p-2 opacity-80 hover:opacity-100"
        onClick={dismiss}
      >
        <XIcon aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  );
}
