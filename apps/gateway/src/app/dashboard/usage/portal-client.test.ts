import { describe, expect, it, vi } from "vitest";
import { openBillingPortal } from "./portal-client";

function response(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json:
      body === undefined
        ? () => Promise.reject(new Error("no body"))
        : () => Promise.resolve(body),
  } as unknown as Response;
}

describe("openBillingPortal", () => {
  it("posts to the portal route and redirects to the session url", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        response(200, { url: "https://billing.stripe.com/p/session/test_x" })
      );

    const outcome = await openBillingPortal(fetchFn);

    expect(fetchFn).toHaveBeenCalledWith("/api/billing/portal", {
      method: "POST",
    });
    expect(outcome).toEqual({
      kind: "redirect",
      url: "https://billing.stripe.com/p/session/test_x",
    });
  });

  it("sends an expired session through login and back to the usage page", async () => {
    const outcome = await openBillingPortal(
      vi.fn().mockResolvedValue(response(401, { error: "Unauthorized" }))
    );
    expect(outcome).toEqual({
      kind: "redirect",
      url: "/auth/login?next=%2Fdashboard%2Fusage",
    });
  });

  it("surfaces a missing billing account as our problem, not a retry", async () => {
    const outcome = await openBillingPortal(
      vi.fn().mockResolvedValue(response(400, { error: "No billing account" }))
    );
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.message).toContain("Contact us");
    }
  });

  it("reports an error when billing is unavailable", async () => {
    const outcome = await openBillingPortal(
      vi
        .fn()
        .mockResolvedValue(response(503, { error: "Billing is not configured" }))
    );
    expect(outcome.kind).toBe("error");
  });

  it("reports an error when the network call throws", async () => {
    const outcome = await openBillingPortal(
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
    );
    expect(outcome.kind).toBe("error");
  });

  it("treats a 200 without a usable url as an error, never a blind redirect", async () => {
    const outcome = await openBillingPortal(
      vi.fn().mockResolvedValue(response(200, {}))
    );
    expect(outcome.kind).toBe("error");
  });

  it("refuses a 200 whose url is not Stripe-hosted — the server response is trusted, not obeyed", async () => {
    const outcome = await openBillingPortal(
      vi.fn().mockResolvedValue(response(200, { url: "https://evil.com/portal" }))
    );
    expect(outcome.kind).toBe("error");
  });
});
