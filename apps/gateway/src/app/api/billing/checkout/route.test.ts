import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const sessionUserId = vi.fn<() => Promise<string | null>>();
vi.mock("@/lib/session", () => ({ getSessionUserId: () => sessionUserId() }));

const sessionsCreate = vi.fn();
const ensureStripeCustomer = vi.fn();
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ checkout: { sessions: { create: sessionsCreate } } }),
  ensureStripeCustomer: (...args: unknown[]) => ensureStripeCustomer(...args),
}));

const selectWhere = vi.fn();
const updateWhere = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: selectWhere }) }) }),
    update: () => ({ set: () => ({ where: updateWhere }) }),
  },
}));

const env: Record<string, string> = {
  STRIPE_API_KEY: "sk_test_x",
  STRIPE_PRO_MONTHLY_PRICE_ID: "price_monthly",
  STRIPE_PRO_YEARLY_PRICE_ID: "price_yearly",
  STRIPE_PROMOTION_CODE_ID: "",
  GATEWAY_BASE_URL: "https://example.test",
};
vi.mock("@datatorag-mcp/config", () => ({ getEnv: () => env }));

import { POST } from "./route";

const USER = "11111111-1111-1111-1111-111111111111";

function checkoutRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/billing/checkout", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  env.STRIPE_PROMOTION_CODE_ID = "";
  vi.useRealTimers();
  sessionUserId.mockResolvedValue(USER);
  selectWhere.mockResolvedValue([
    { email: "u@example.com", stripeCustomerId: null, plan: "free" },
  ]);
  updateWhere.mockResolvedValue(undefined);
  ensureStripeCustomer.mockResolvedValue("cus_new");
  sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.test/s" });
});

describe("POST /api/billing/checkout", () => {
  it("401s without a session", async () => {
    sessionUserId.mockResolvedValue(null);
    const res = await POST(checkoutRequest({ interval: "monthly" }));
    expect(res.status).toBe(401);
  });

  it("400s an unknown interval", async () => {
    const res = await POST(checkoutRequest({ interval: "weekly" }));
    expect(res.status).toBe(400);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("409s a user already on Pro — no second subscription", async () => {
    selectWhere.mockResolvedValue([
      { email: "u@example.com", stripeCustomerId: "cus_1", plan: "pro" },
    ]);
    const res = await POST(checkoutRequest({ interval: "monthly" }));
    expect(res.status).toBe(409);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("creates a monthly checkout session, persists the customer link first, returns the URL", async () => {
    const res = await POST(checkoutRequest({ interval: "monthly" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.test/s" });
    // Customer link persisted BEFORE the redirect exists so webhook ordering
    // can never matter — see the route comment.
    expect(updateWhere).toHaveBeenCalled();
    expect(sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        customer: "cus_new",
        client_reference_id: USER,
        line_items: [{ price: "price_monthly", quantity: 1 }],
        subscription_data: { metadata: { user_id: USER } },
      })
    );
  });

  it("always allows promotion codes — the field is how a couponed customer avoids being charged", async () => {
    // Pinned on its own because this is exactly the param a refactor drops
    // silently: nothing else fails, the hosted page just stops rendering the
    // promo-code field, and the first person to notice is a customer with a
    // code and nowhere to type it.
    await POST(checkoutRequest({ interval: "monthly" }));
    expect(sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ allow_promotion_codes: true })
    );
  });

  it("uses the yearly price for interval=yearly", async () => {
    await POST(checkoutRequest({ interval: "yearly" }));
    expect(sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ line_items: [{ price: "price_yearly", quantity: 1 }] })
    );
  });

  it("does not re-write the customer link when one already exists", async () => {
    selectWhere.mockResolvedValue([
      { email: "u@example.com", stripeCustomerId: "cus_existing", plan: "free" },
    ]);
    await POST(checkoutRequest({ interval: "monthly" }));
    expect(updateWhere).not.toHaveBeenCalled();
    expect(sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_new" })
    );
  });
});

/* SCRUM-231: the campaign code is APPLIED at checkout, not only shown. Stripe
 * refuses `discounts` together with `allow_promotion_codes`, so the two are
 * mutually exclusive here by construction. */
describe("POST /api/billing/checkout with the campaign promo", () => {
  function createArgs(): Record<string, unknown> {
    return sessionsCreate.mock.calls[0]![0] as Record<string, unknown>;
  }

  it("applies the promotion code through discounts when the code is the campaign's, the campaign is active and the id is configured", async () => {
    env.STRIPE_PROMOTION_CODE_ID = "promo_test_id";
    vi.useFakeTimers({ now: new Date("2026-10-01T12:00:00Z"), toFake: ["Date"] });
    const res = await POST(checkoutRequest({ interval: "monthly", promo: "DTR50" }));
    expect(res.status).toBe(200);
    const args = createArgs();
    expect(args.discounts).toEqual([{ promotion_code: "promo_test_id" }]);
    expect(args).not.toHaveProperty("allow_promotion_codes");
  });

  it("falls back to the open promo-code field when the id is not configured", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-01T12:00:00Z"), toFake: ["Date"] });
    await POST(checkoutRequest({ interval: "monthly", promo: "DTR50" }));
    const args = createArgs();
    expect(args).not.toHaveProperty("discounts");
    expect(args.allow_promotion_codes).toBe(true);
  });

  it("ignores a wrong code and an expired campaign, and never trusts the body for the id", async () => {
    env.STRIPE_PROMOTION_CODE_ID = "promo_test_id";
    vi.useFakeTimers({ now: new Date("2026-10-01T12:00:00Z"), toFake: ["Date"] });
    await POST(checkoutRequest({ interval: "monthly", promo: "OTHER" }));
    expect(createArgs()).not.toHaveProperty("discounts");
    sessionsCreate.mockClear();
    vi.useFakeTimers({ now: new Date("2026-12-07T00:00:01Z"), toFake: ["Date"] });
    await POST(checkoutRequest({ interval: "monthly", promo: "DTR50" }));
    expect(createArgs()).not.toHaveProperty("discounts");
    expect(createArgs().allow_promotion_codes).toBe(true);
    sessionsCreate.mockClear();
    // A non-string promo never reaches Stripe: the body schema refuses it.
    const bad = await POST(checkoutRequest({ interval: "monthly", promo: { promotion_code: "promo_evil" } }));
    expect(bad.status).toBe(400);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });
});
