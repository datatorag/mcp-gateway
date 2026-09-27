// @vitest-environment jsdom

/**
 * The Billing page (SCRUM-352) on a real render, across the states the ticket
 * names: Free with no Stripe customer (no payment or invoice sections, and no
 * empty cards), Pro with zero invoices, Pro with no payment method, Pro billed
 * outside Stripe, and Stripe failing. The SCRUM-81 gate carries over: the
 * portal controls need a Stripe customer, whatever the plan says.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { BillingUsage } from "@/gateway/usage/period";
import type { BillingDetails } from "@/lib/billing-details";

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { BillingView } = await import("./billing-view");

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

const usage = (over: Partial<BillingUsage> = {}): BillingUsage => ({
  plan: "free",
  calls: 40,
  callsIncluded: 250,
  agentRuns: 3,
  agentRunCap: 25,
  resetsAt: new Date("2026-10-12T00:00:00Z"),
  lapsed: false,
  hardCap: true,
  ...over,
});

const CARD = { ok: true as const, value: { type: "card", brand: "visa", last4: "4242", expMonth: 4, expYear: 2029 } };
const INVOICES = {
  ok: true as const,
  value: [
    { id: "in_1", created: new Date("2026-09-12T00:00:00Z"), amount: 2000, currency: "usd", status: "paid", pdfUrl: "https://pay.stripe.com/invoice/x/pdf" },
    { id: "in_2", created: new Date("2026-08-12T00:00:00Z"), amount: 2000, currency: "usd", status: "paid", pdfUrl: null },
  ],
};

function render(props: Parameters<typeof BillingView>[0]) {
  act(() => {
    root.render(<BillingView {...props} />);
  });
  return container;
}

const section = (name: string) => container.querySelector(`[data-section="${name}"]`);
const buttons = () => Array.from(container.querySelectorAll("button")).map((b) => b.textContent?.trim());
const text = () => container.textContent ?? "";

describe("Billing page states", () => {
  it("Free with no Stripe customer: plan cards and usage, and no payment or invoice section at all", () => {
    render({ plan: "free", hasBillingAccount: false, usage: usage() });
    expect(section("usage")).not.toBeNull();
    expect(section("payment")).toBeNull();
    expect(section("invoices")).toBeNull();
    expect(text()).not.toContain("Payment method");
    expect(text()).not.toContain("Invoices");
    expect(text()).not.toContain("No invoices");
    // Upgrade on the Pro card; no portal controls anywhere.
    expect(buttons()).toContain("Upgrade to Pro");
    expect(buttons()).not.toContain("Manage or cancel");
    expect(buttons()).not.toContain("Downgrade");
  });

  it("details without a Stripe customer still show no payment or invoice section", () => {
    // The page only loads details for a customer; the view holds the same
    // rule itself, so a caller that passes details anyway cannot put portal
    // controls in front of an account the portal would 400 for.
    render({ plan: "free", hasBillingAccount: false, usage: usage(), details: { paymentMethod: CARD, invoices: INVOICES } });
    expect(section("payment")).toBeNull();
    expect(section("invoices")).toBeNull();
    expect(buttons()).not.toContain("Update");
  });

  it("Pro with a card and invoices: every section, with the card and the invoice rows", () => {
    render({ plan: "pro", hasBillingAccount: true, usage: usage({ plan: "pro", callsIncluded: 2000, agentRunCap: 100, hardCap: false }), details: { paymentMethod: CARD, invoices: INVOICES } });
    expect(section("payment")!.textContent).toContain("Visa ending in 4242");
    expect(section("payment")!.textContent).toContain("Expires 04/2029");
    expect(container.querySelectorAll("[data-invoice]")).toHaveLength(2);
    expect(section("invoices")!.textContent).toContain("$20.00");
    // The PDF link only where Stripe gave a Stripe-hosted one.
    const pdfs = Array.from(container.querySelectorAll('[data-invoice] a')).map((a) => a.getAttribute("href"));
    expect(pdfs).toEqual(["https://pay.stripe.com/invoice/x/pdf"]);
    expect(buttons()).toEqual(expect.arrayContaining(["Manage or cancel", "Downgrade", "Update", "All invoices"]));
    expect(buttons()).not.toContain("Upgrade to Pro");
  });

  it("Pro with zero invoices: one quiet line, no card chrome around it", () => {
    render({ plan: "pro", hasBillingAccount: true, usage: usage({ plan: "pro" }), details: { paymentMethod: CARD, invoices: { ok: true, value: [] } } });
    const inv = section("invoices")!;
    expect(inv.textContent).toBe("No invoices yet.");
    expect(inv.className).not.toMatch(/border|rounded/);
  });

  it("Pro with no payment method: the payment section does not render", () => {
    render({ plan: "pro", hasBillingAccount: true, usage: usage({ plan: "pro" }), details: { paymentMethod: { ok: true, value: null }, invoices: INVOICES } });
    expect(section("payment")).toBeNull();
    expect(section("invoices")).not.toBeNull();
  });

  it("Pro billed outside Stripe: no portal control anywhere, and the reason in its place", () => {
    render({ plan: "pro", hasBillingAccount: false, usage: usage({ plan: "pro" }) });
    expect(buttons()).not.toContain("Manage or cancel");
    expect(buttons()).not.toContain("Downgrade");
    expect(text()).toContain("isn't billed through Stripe");
    expect(section("payment")).toBeNull();
  });

  it("Stripe failing: each section says so and still offers the portal; the page renders", () => {
    render({ plan: "pro", hasBillingAccount: true, usage: usage({ plan: "pro" }), details: { paymentMethod: { ok: false }, invoices: { ok: false } } as BillingDetails });
    expect(section("payment")!.textContent).toContain("Couldn't load your payment method");
    expect(section("invoices")!.textContent).toContain("Couldn't load your invoices");
    expect(buttons()).toEqual(expect.arrayContaining(["Update", "All invoices"]));
  });

  it("unknown plan values are shown as Free, as enforcement treats them", () => {
    render({ plan: "payg", hasBillingAccount: false, usage: usage() });
    expect(container.querySelector('[data-current="true"]')!.getAttribute("data-tier")).toBe("Free");
  });
});

describe("usage this period", () => {
  it("shows used of the allowance, both meters, and the reset date", () => {
    render({ plan: "free", hasBillingAccount: false, usage: usage() });
    const values = Array.from(container.querySelectorAll("[data-meter-value]")).map((e) => e.textContent);
    expect(values).toEqual(["40 of 250", "3 of 25"]);
    expect(section("usage")!.textContent).toContain("Resets October 12, 2026.");
  });

  it("a lapsed period says it resets on the next call", () => {
    render({ plan: "free", hasBillingAccount: false, usage: usage({ calls: 0, agentRuns: 0, resetsAt: null, lapsed: true }) });
    expect(section("usage")!.textContent).toContain("Your allowance resets on your next call.");
  });

  it("Free at the cap says calls are paused; Pro over the allowance says nothing is paused and the bar stops at full", () => {
    render({ plan: "free", hasBillingAccount: false, usage: usage({ calls: 250 }) });
    expect(section("usage")!.textContent).toContain("tool calls are paused until it resets");
    act(() => root.render(<BillingView plan="pro" hasBillingAccount={false} usage={usage({ plan: "pro", calls: 2140, callsIncluded: 2000, hardCap: false })} />));
    expect(section("usage")!.textContent).toContain("2,140 of 2,000");
    expect(section("usage")!.textContent).toContain("Nothing is paused.");
    const bar = container.querySelector('[role="progressbar"] > div') as HTMLDivElement;
    expect(bar.style.width).toBe("100%");
  });

  it("an exempt account reads not capped and draws no bar", () => {
    render({ plan: "free", hasBillingAccount: false, usage: usage({ callsIncluded: null, agentRunCap: null }) });
    expect(section("usage")!.textContent).toContain("40 used, not capped");
    expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(0);
  });
});

describe("copy", () => {
  it("claims no cancellation state and has no em dashes, in every state", () => {
    const states: Array<Parameters<typeof BillingView>[0]> = [
      { plan: "free", hasBillingAccount: false, usage: usage() },
      { plan: "pro", hasBillingAccount: true, usage: usage({ plan: "pro" }), details: { paymentMethod: CARD, invoices: INVOICES } },
      { plan: "pro", hasBillingAccount: false, usage: usage({ plan: "pro" }) },
      { plan: "pro", hasBillingAccount: true, usage: usage({ plan: "pro" }), details: { paymentMethod: { ok: false }, invoices: { ok: false } } },
    ];
    for (const props of states) {
      render(props);
      expect(text()).not.toMatch(/downgraded|cancelled|canceled|cancelling/i);
      expect(text()).not.toContain("—");
    }
  });

  it("the cancellation sentence sits with the cancel action on the Pro card", () => {
    render({ plan: "pro", hasBillingAccount: true, usage: usage({ plan: "pro" }), details: { paymentMethod: CARD, invoices: INVOICES } });
    const pro = container.querySelector('[data-tier="Pro"]')!;
    expect(pro.textContent).toContain("Manage or cancel");
    expect(pro.textContent).toContain("If you cancel, Pro stays active until the end of the period you've paid for.");
  });
});
