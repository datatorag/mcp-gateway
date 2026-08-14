// @vitest-environment jsdom

/**
 * The two acceptance facts of the billing card, asserted on a real render:
 * a Pro user has a live one-click path to the portal, and a free user is
 * never shown a control that would 400 for them. Rendering matters here —
 * the plan gate is a JSX conditional, and only a mounted component can show
 * which side of it a given plan actually lands on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));

const { BillingCard } = await import("./billing-card");

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

function render(plan: string, navigate = vi.fn()) {
  act(() => {
    root.render(<BillingCard plan={plan} navigate={navigate} />);
  });
  return navigate;
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(text)
  );
}

describe("BillingCard", () => {
  it("pro: renders Manage billing, and clicking it reaches the portal in one click", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ url: "https://billing.stripe.com/p/session/test_x" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const navigate = render("pro");
    const button = buttonByText("Manage billing");
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

  it("pro: states that a cancellation keeps Pro until period end, and claims no downgrade", () => {
    render("pro");
    const text = container.textContent ?? "";
    expect(text).toContain("Pro stays active until the end of the period");
    // The card must never assert a downgrade — users.plan is still "pro"
    // after an in-portal cancellation, until the webhook ends the period.
    expect(text).not.toMatch(/downgraded|cancelled|canceled/i);
  });

  it("free: no portal button, and the alternative control is a live link to /pricing", () => {
    render("free");
    expect(buttonByText("Manage billing")).toBeUndefined();
    const link = container.querySelector('a[href="/pricing"]');
    expect(link?.textContent).toContain("See plans");
  });

  it("unknown plan values fall on the free side of the gate, never a dead portal button", () => {
    render("payg");
    expect(buttonByText("Manage billing")).toBeUndefined();
    expect(container.querySelector('a[href="/pricing"]')).not.toBeNull();
  });

  it("portal failure shows the error and re-enables the button, with no navigation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ error: "Billing is not configured" }),
      })
    );

    const navigate = render("pro");
    const button = buttonByText("Manage billing");
    await act(async () => {
      button!.click();
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(buttonByText("Manage billing")?.disabled).toBe(false);
  });

  it("renders no em-dashes in either plan state", () => {
    for (const plan of ["pro", "free"]) {
      render(plan);
      expect(container.textContent).not.toContain("—");
    }
  });
});
