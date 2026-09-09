import { describe, expect, it } from "vitest";
import { PROMO, promoActive, promoCopy, promoPricingHref, PROMO_DISMISSED_KEY } from "./promo";

/* SCRUM-231: the campaign as one constant. The end date is both the last
 * day the code can be redeemed and the day the banner retires, so the copy
 * and the switch read the same value; the tests inject the clock. */

describe("promoActive", () => {
  it("is active the day before and on the end date, in UTC", () => {
    expect(promoActive(new Date("2026-12-05T12:00:00Z"))).toBe(true);
    expect(promoActive(new Date("2026-12-06T23:59:59Z"))).toBe(true);
  });

  it("is inactive from the first instant after the end date", () => {
    expect(promoActive(new Date("2026-12-07T00:00:00Z"))).toBe(false);
    expect(promoActive(new Date("2027-01-01T00:00:00Z"))).toBe(false);
  });

  it("is active today, which is what makes the campaign live at all", () => {
    expect(promoActive(new Date("2026-09-09T00:00:00Z"))).toBe(true);
  });
});

describe("the constant and the copy", () => {
  it("names the code and the end date once", () => {
    expect(PROMO.code).toBe("DTR50");
    expect(PROMO.endsOn).toBe("2026-12-06");
    expect(PROMO_DISMISSED_KEY).toContain("dtr50");
  });

  it("says both windows, the discount's year and the code's redeem-by date, never one for the other", () => {
    const copy = promoCopy();
    expect(copy.headline).toBe("50% off Pro for a year with code DTR50");
    expect(copy.redeemBy).toBe("Redeem by December 6");
    expect(copy.headline).toContain("for a year");
    expect(copy.redeemBy).not.toContain("year");
  });

  it("has no em-dashes anywhere in the copy", () => {
    const copy = promoCopy();
    expect(Object.values(copy).join(" ")).not.toContain("\u2014");
  });

  it("links to pricing with the code in the query", () => {
    expect(promoPricingHref()).toBe("/pricing?promo=DTR50");
  });
});
