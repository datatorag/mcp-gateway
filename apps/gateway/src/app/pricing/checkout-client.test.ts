import { describe, expect, it, vi } from "vitest";
import { startProCheckout } from "./checkout-client";

function response(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: body === undefined ? () => Promise.reject(new Error("no body")) : () => Promise.resolve(body),
  } as unknown as Response;
}

describe("startProCheckout", () => {
  it("posts the chosen interval and redirects to the session url", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(response(200, { url: "https://checkout.stripe.com/c/pay/cs_test_x" }));

    const outcome = await startProCheckout("yearly", fetchFn);

    expect(fetchFn).toHaveBeenCalledWith(
      "/api/billing/checkout",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ interval: "yearly" }),
      })
    );
    expect(outcome).toEqual({
      kind: "redirect",
      url: "https://checkout.stripe.com/c/pay/cs_test_x",
    });
  });

  it("sends a signed-out visitor through login with next back to /pricing", async () => {
    const outcome = await startProCheckout(
      "monthly",
      vi.fn().mockResolvedValue(response(401, { error: "Unauthorized" }))
    );
    expect(outcome).toEqual({
      kind: "redirect",
      url: "/auth/login?next=%2Fpricing",
    });
  });

  it("sends an existing Pro subscriber to the dashboard instead of a second checkout", async () => {
    const outcome = await startProCheckout(
      "monthly",
      vi.fn().mockResolvedValue(response(409, { error: "Already on Pro" }))
    );
    expect(outcome).toEqual({ kind: "redirect", url: "/dashboard" });
  });

  it("reports an error when billing is unavailable, without redirecting anywhere", async () => {
    const outcome = await startProCheckout(
      "monthly",
      vi.fn().mockResolvedValue(response(503, { error: "Billing is not configured" }))
    );
    expect(outcome.kind).toBe("error");
  });

  it("reports an error when the network call itself throws", async () => {
    const outcome = await startProCheckout(
      "monthly",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
    );
    expect(outcome.kind).toBe("error");
  });

  it("treats a 200 without a usable url as an error, never a redirect to nowhere", async () => {
    const outcome = await startProCheckout(
      "monthly",
      vi.fn().mockResolvedValue(response(200, { url: null }))
    );
    expect(outcome.kind).toBe("error");
  });
});
