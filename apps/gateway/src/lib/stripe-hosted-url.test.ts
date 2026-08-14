import { describe, expect, it } from "vitest";
import { isStripeHostedUrl } from "./stripe-hosted-url";

describe("isStripeHostedUrl", () => {
  it("accepts the two hosted surfaces we actually follow", () => {
    expect(
      isStripeHostedUrl("https://checkout.stripe.com/c/pay/cs_test_x")
    ).toBe(true);
    expect(
      isStripeHostedUrl("https://billing.stripe.com/p/session/test_x")
    ).toBe(true);
    expect(isStripeHostedUrl("https://stripe.com/")).toBe(true);
  });

  it("rejects everything else, each a named escape shape", () => {
    // Wrong host entirely
    expect(isStripeHostedUrl("https://evil.com/pay")).toBe(false);
    // Suffix without the dot boundary
    expect(isStripeHostedUrl("https://evilstripe.com/pay")).toBe(false);
    // stripe.com as a subdomain of the attacker
    expect(isStripeHostedUrl("https://billing.stripe.com.evil.com/x")).toBe(
      false
    );
    // Right host, wrong scheme
    expect(isStripeHostedUrl("http://billing.stripe.com/x")).toBe(false);
    // Not a URL at all
    expect(isStripeHostedUrl("/relative/path")).toBe(false);
    expect(isStripeHostedUrl("javascript:alert(1)")).toBe(false);
  });
});
