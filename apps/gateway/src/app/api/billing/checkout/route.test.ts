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

vi.mock("@datatorag-mcp/config", () => ({
  getEnv: () => ({
    STRIPE_API_KEY: "sk_test_x",
    STRIPE_PRO_MONTHLY_PRICE_ID: "price_monthly",
    STRIPE_PRO_YEARLY_PRICE_ID: "price_yearly",
    GATEWAY_BASE_URL: "https://example.test",
  }),
}));

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
