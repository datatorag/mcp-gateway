// @vitest-environment jsdom

/**
 * The shared plan cards (SCRUM-352). In pricing mode they must render as
 * /pricing always has; in billing mode exactly one card, the user's own, is
 * highlighted and badged, and the actions are the ones that user can take.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { PlanCards, TIERS } = await import("./plan-cards");
const { freeAllowanceBullet, proAllowanceBullet, PRO_RUNS_BULLET } = await import("@/app/pricing/allowances");

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

function render(el: React.ReactElement) {
  act(() => root.render(el));
}
const cards = () => Array.from(container.querySelectorAll<HTMLDivElement>(":scope > div > div"));
const highlighted = () => cards().filter((c) => c.className.includes("border-primary/40"));
const actions = (card: Element) =>
  Array.from(card.querySelectorAll("button, a")).map((e) => e.textContent?.trim()).filter((t) => t && !/^(monthly|yearly)$/.test(t));

describe("pricing mode (no current plan)", () => {
  it("renders the three tiers with the allowance lines from allowances.ts", () => {
    render(<PlanCards />);
    expect(cards().map((c) => c.querySelector("h2")!.textContent)).toEqual(["Free", "Pro", "Enterprise"]);
    expect(container.textContent).toContain(freeAllowanceBullet());
    expect(container.textContent).toContain(proAllowanceBullet());
    expect(container.textContent).toContain(PRO_RUNS_BULLET);
  });

  it("highlights Pro only, carries no badge or billing attributes, and keeps the sign-up actions", () => {
    render(<PlanCards />);
    expect(highlighted().map((c) => c.querySelector("h2")!.textContent)).toEqual(["Pro"]);
    expect(container.textContent).not.toContain("Current plan");
    expect(container.querySelector("[data-tier]")).toBeNull();
    const [free, pro, ent] = cards();
    expect(actions(free)).toEqual(["Start free"]);
    expect(actions(pro)).toEqual(["Upgrade to Pro"]);
    expect(actions(ent)).toEqual(["Talk to us"]);
  });
});

describe("billing mode (the signed-in user's plan)", () => {
  it("on Free: the Free card is current and the only one highlighted; Upgrade on Pro; nothing on Free", () => {
    render(<PlanCards current={{ plan: "free", hasBillingAccount: false }} />);
    expect(highlighted().map((c) => c.getAttribute("data-tier"))).toEqual(["Free"]);
    const current = container.querySelectorAll('[data-current="true"]');
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain("Current plan");
    const [free, pro, ent] = cards();
    expect(actions(free)).toEqual([]);
    expect(actions(pro)).toEqual(["Upgrade to Pro"]);
    expect(actions(ent)).toEqual(["Talk to us"]);
  });

  it("on Pro with a Stripe customer: Pro is current, with Manage or cancel and the sentence; Downgrade on Free", () => {
    render(<PlanCards current={{ plan: "pro", hasBillingAccount: true }} />);
    expect(highlighted().map((c) => c.getAttribute("data-tier"))).toEqual(["Pro"]);
    const [free, pro] = cards();
    expect(actions(pro)).toEqual(["Manage or cancel"]);
    expect(pro.textContent).toContain("Pro stays active until the end of the period you've paid for");
    expect(pro.textContent).toContain("$20");
    expect(actions(free)).toEqual(["Downgrade"]);
  });

  it("on Pro with no Stripe customer: no portal control, the reason instead", () => {
    render(<PlanCards current={{ plan: "pro", hasBillingAccount: false }} />);
    const [free, pro] = cards();
    expect(actions(pro)).toEqual([]);
    expect(pro.textContent).toContain("isn't billed through Stripe");
    expect(actions(free)).toEqual([]);
  });

  it("the tier data is the one table both pages read", () => {
    expect(TIERS.map((t) => t.name)).toEqual(["Free", "Pro", "Enterprise"]);
  });
});
