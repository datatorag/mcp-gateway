// @vitest-environment jsdom

/**
 * The usage page's billing section is a SUMMARY since billing got its own
 * route: plan line plus the link in. The portal button and its gating live
 * on /dashboard/billing — a second copy here would be the drift the
 * one-page-per-concern split exists to prevent.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

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
});

function render(plan: string) {
  act(() => {
    root.render(<BillingCard plan={plan} />);
  });
}

describe("BillingCard (usage summary)", () => {
  it("shows the plan and links to the billing page, for pro and free alike", () => {
    for (const [plan, label] of [
      ["pro", "You're on the Pro plan."],
      ["free", "You're on the Free plan."],
    ]) {
      render(plan);
      expect(container.textContent).toContain(label);
      const link = container.querySelector('a[href="/dashboard/billing"]');
      expect(link?.textContent).toContain("Billing details");
    }
  });

  it("renders no portal button — that control lives on the billing page", () => {
    render("pro");
    expect(container.querySelector("button")).toBeNull();
  });

  it("claims no cancellation state and contains no em-dashes", () => {
    for (const plan of ["pro", "free"]) {
      render(plan);
      const text = container.textContent ?? "";
      expect(text).not.toMatch(/downgraded|cancelled|canceled/i);
      expect(text).not.toContain("—");
    }
  });
});
