// @vitest-environment jsdom

/**
 * The SCRUM-81 gate matrix on a real render. The manage control's
 * precondition is the BILLING RELATIONSHIP (stripe_customer_id), not the
 * plan — a manually-promoted Pro account has plan=pro and no customer, and
 * the portal 400s for it. Only a mounted component can show which side of
 * the two-variable gate each (plan, hasBillingAccount) pair lands on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));

const { BillingClient } = await import("./billing-client");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function render(
  plan: string,
  hasBillingAccount: boolean,
  navigate = vi.fn()
) {
  act(() => {
    root.render(
      <BillingClient
        plan={plan}
        hasBillingAccount={hasBillingAccount}
        freeCallsLabel="250"
        proCallsLabel="2,000"
        navigate={navigate}
      />
    );
  });
  return navigate;
}

function manageButton(): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("Manage billing")
  );
}

describe("BillingClient", () => {
  it("pro WITH a billing account: Manage billing works in one click", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ url: "https://billing.stripe.com/p/session/test_x" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const navigate = render("pro", true);
    const button = manageButton();
    expect(button).toBeDefined();

    await act(async () => {
      button!.click();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/billing/portal", {
      method: "POST",
    });
    expect(navigate).toHaveBeenCalledWith(
      "https://billing.stripe.com/p/session/test_x"
    );
  });

  it("pro WITHOUT a billing account: no dead control, and an explanation instead", () => {
    render("pro", false);
    expect(manageButton()).toBeUndefined();
    // Still described as Pro — the plan is real even when nobody is billed.
    expect(container.textContent).toContain("Pro");
    expect(container.textContent).toContain("nothing to manage");
    // And NOT told to upgrade — they already have the plan.
    expect(container.querySelector('a[href="/pricing"]')).toBeNull();
  });

  it("free: See plans link, no manage control, allowance from the server-fed constant", () => {
    render("free", false);
    expect(manageButton()).toBeUndefined();
    const link = container.querySelector('a[href="/pricing"]');
    expect(link?.textContent).toContain("See plans");
    expect(container.textContent).toContain("250 tool calls a month");
  });

  it("unknown plan values land on the free side of the gate", () => {
    render("payg", false);
    expect(manageButton()).toBeUndefined();
    expect(container.querySelector('a[href="/pricing"]')).not.toBeNull();
  });

  it("a free user who somehow carries a customer id still gets no manage control", () => {
    // Both variables must agree before the control renders: a stale customer
    // link on a downgraded account manages a subscription that no longer
    // exists, which is the portal-shaped version of the dead button.
    render("free", true);
    expect(manageButton()).toBeUndefined();
  });

  it("portal failure shows the error, re-enables the button, and never navigates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ error: "Billing is not configured" }),
      })
    );

    const navigate = render("pro", true);
    await act(async () => {
      manageButton()!.click();
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(manageButton()?.disabled).toBe(false);
  });

  it("claims no cancellation state and contains no em-dashes, in every state", () => {
    for (const [plan, has] of [
      ["pro", true],
      ["pro", false],
      ["free", false],
    ] as const) {
      render(plan, has);
      const text = container.textContent ?? "";
      expect(text).not.toMatch(/downgraded|cancelled|canceled/i);
      expect(text).not.toContain("—");
    }
  });
});
