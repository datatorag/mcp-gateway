/**
 * The promo campaign as one constant (SCRUM-231). No server imports: the
 * banner (a client component) and the checkout route (server) read the same
 * values, so the copy, the link, the switch and the code cannot drift.
 *
 * Two windows, said in their own words and never one standing for the other
 * (per HQ decision): the DISCOUNT runs for a year once redeemed; the CODE
 * can be redeemed until the end date. The end date is also the day the
 * banner retires itself, so the copy and the switch read one value. The
 * Stripe promotion code id is configuration, never here; the customer-facing
 * code is the only string the repo knows.
 */
export const PROMO = {
  code: "DTR50",
  /** Last day the code can be redeemed, and the day the banner retires. */
  endsOn: "2026-12-06",
} as const;

/** The dismissal memory, named for the campaign so a later one starts fresh. */
export const PROMO_DISMISSED_KEY = "dtr-promo-dtr50-dismissed";

/** Active through the whole of the end date in UTC; inactive from the first
 * instant after. Takes the clock so the before/after tests inject one. */
export function promoActive(now: Date): boolean {
  return now.getTime() < Date.parse(`${PROMO.endsOn}T23:59:59.999Z`) + 1;
}

export function promoCopy(): { discount: string; headline: string; redeemBy: string; cta: string } {
  const discount = "50% off Pro for a year";
  return {
    /** The discount's window alone, for surfaces that name the code separately. */
    discount,
    headline: `${discount} with code ${PROMO.code}`,
    redeemBy: "Redeem by December 6",
    cta: "See pricing",
  };
}

export function promoPricingHref(): string {
  return `/pricing?promo=${PROMO.code}`;
}

/** Whether a value from a URL or a request body is the campaign's code. */
export function isPromoCode(value: unknown): value is typeof PROMO.code {
  return typeof value === "string" && value.trim().toUpperCase() === PROMO.code;
}
