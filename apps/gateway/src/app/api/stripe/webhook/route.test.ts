import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// The real cryptographic verification is Stripe SDK code and is exercised
// live by `stripe listen` in the e2e pass; these tests pin the ROUTE's
// behaviour around it — refuse unconfigured, refuse unsigned, refuse bad
// signatures, 500 (so Stripe retries) when the handler throws.
const constructEventAsync = vi.fn();
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ webhooks: { constructEventAsync } }),
}));

const handleStripeEvent = vi.fn();
vi.mock("@/gateway/billing/webhook-handlers", () => ({
  handleStripeEvent: (...args: unknown[]) => handleStripeEvent(...args),
}));

vi.mock("@/lib/db", () => ({ db: {} }));

const env = { STRIPE_WEBHOOK_SECRET: "whsec_test" };
vi.mock("@datatorag-mcp/config", () => ({
  getEnv: () => env,
}));

import { POST } from "./route";

function webhookRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers,
    body: JSON.stringify({ id: "evt_1", type: "x" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  constructEventAsync.mockResolvedValue({ id: "evt_1", type: "customer.subscription.updated" });
  handleStripeEvent.mockResolvedValue({ duplicate: false, action: "ok" });
});

describe("POST /api/stripe/webhook", () => {
  it("503s when no webhook secret is configured — never accepts unverifiable events", async () => {
    env.STRIPE_WEBHOOK_SECRET = "";
    const res = await POST(webhookRequest({ "stripe-signature": "t=1,v1=abc" }));
    expect(res.status).toBe(503);
    expect(handleStripeEvent).not.toHaveBeenCalled();
  });

  it("400s a request with no signature header without touching the handler", async () => {
    const res = await POST(webhookRequest());
    expect(res.status).toBe(400);
    expect(constructEventAsync).not.toHaveBeenCalled();
    expect(handleStripeEvent).not.toHaveBeenCalled();
  });

  it("400s a bad signature without touching the handler", async () => {
    constructEventAsync.mockRejectedValue(new Error("No signatures found"));
    const res = await POST(webhookRequest({ "stripe-signature": "t=1,v1=forged" }));
    expect(res.status).toBe(400);
    expect(handleStripeEvent).not.toHaveBeenCalled();
  });

  it("passes a verified event to the handler and acknowledges", async () => {
    const res = await POST(webhookRequest({ "stripe-signature": "t=1,v1=good" }));
    expect(res.status).toBe(200);
    expect(constructEventAsync).toHaveBeenCalledWith(
      expect.any(String),
      "t=1,v1=good",
      "whsec_test"
    );
    expect(handleStripeEvent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ id: "evt_1" })
    );
    expect(await res.json()).toEqual({ received: true, duplicate: false, action: "ok" });
  });

  it("500s when the handler throws, so Stripe redelivers", async () => {
    handleStripeEvent.mockRejectedValue(new Error("db down"));
    const res = await POST(webhookRequest({ "stripe-signature": "t=1,v1=good" }));
    expect(res.status).toBe(500);
  });
});
