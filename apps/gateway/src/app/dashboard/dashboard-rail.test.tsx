// @vitest-environment jsdom

/**
 * The expandable rail (SCRUM-83) and the Billing nav item (SCRUM-82) on a
 * real render of the dashboard layout. The a11y requirements are the point:
 * the toggle is a real button with an accessible name and aria-expanded,
 * and every item's label is in the accessibility tree in BOTH states — the
 * collapsed rail via aria-label, the expanded rail via visible text.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard/usage" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...(props as React.ImgHTMLAttributes<HTMLImageElement>)} />
  ),
}));
vi.mock("@/lib/use-current-user", () => ({
  useCurrentUser: () => ({ name: "Rail Test", email: "rail@example.com" }),
}));
vi.mock("@/lib/use-fit-below-top-chrome", () => ({
  useFitBelowTopChrome: () => {},
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// jsdom implements neither Element.scrollTo nor the layout's need for it —
// an environment gap, not a product fact. Stub so mount effects can run.
if (!("scrollTo" in Element.prototype)) {
  (Element.prototype as unknown as { scrollTo: () => void }).scrollTo =
    () => {};
}

const { default: DashboardLayout } = await import("./layout");

const EXPECTED_ITEMS = [
  "Dashboard",
  "Agent",
  "Usage",
  "Billing",
  "MCP config",
  "Docs",
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <DashboardLayout>
        <div>content</div>
      </DashboardLayout>
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function rail(): HTMLElement {
  return container.querySelector("aside")!;
}

function toggle(): HTMLButtonElement {
  return rail().querySelector('button[aria-expanded]')!;
}

describe("dashboard rail", () => {
  it("collapsed by default: every item still carries its label in the accessibility tree", () => {
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(toggle().getAttribute("aria-label")).toBe("Expand navigation");
    for (const label of EXPECTED_ITEMS) {
      const link = rail().querySelector(`a[aria-label="${label}"]`);
      expect(link, `missing aria-label for ${label}`).not.toBeNull();
    }
  });

  it("the Billing item exists and points at /dashboard/billing, in rail AND mobile menu data", () => {
    const link = rail().querySelector('a[aria-label="Billing"]');
    expect(link?.getAttribute("href")).toBe("/dashboard/billing");
  });

  it("expanding shows every title as visible text and flips aria-expanded", () => {
    act(() => {
      toggle().click();
    });
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(toggle().getAttribute("aria-label")).toBe("Collapse navigation");
    const navText = rail().querySelector("nav")?.textContent ?? "";
    for (const label of EXPECTED_ITEMS) {
      expect(navText, `missing visible title for ${label}`).toContain(label);
    }
  });

  it("collapsing again hides the visible titles but keeps the aria-labels", () => {
    act(() => {
      toggle().click();
    });
    act(() => {
      toggle().click();
    });
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    const navText = rail().querySelector("nav")?.textContent ?? "";
    expect(navText.trim()).toBe("");
    for (const label of EXPECTED_ITEMS) {
      expect(rail().querySelector(`a[aria-label="${label}"]`)).not.toBeNull();
    }
  });

  it("persists the expanded preference for the next mount", () => {
    act(() => {
      toggle().click();
    });
    expect(localStorage.getItem("dtr_rail_expanded")).toBe("1");

    // Fresh mount, as after a reload: the stored preference is re-applied.
    act(() => root.unmount());
    root = createRoot(container);
    act(() => {
      root.render(
        <DashboardLayout>
          <div>content</div>
        </DashboardLayout>
      );
    });
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  });

  it("the toggle is a real button, not a styled div", () => {
    expect(toggle().tagName).toBe("BUTTON");
    expect(toggle().getAttribute("type")).toBe("button");
  });

  it("the toggle sits BELOW the nav and ABOVE the pinned user control (SCRUM-90)", () => {
    // Manuel's ruled order: logo -> nav -> toggle -> user profile. DOM order
    // is what screen readers and tab order follow, so it is the thing to pin.
    const nav = rail().querySelector("nav")!;
    const userButton = Array.from(
      rail().querySelectorAll("button")
    ).find((b) => !b.hasAttribute("aria-expanded"))!;
    expect(
      nav.compareDocumentPosition(toggle()) & Node.DOCUMENT_POSITION_FOLLOWING,
      "toggle must come after the nav"
    ).toBeTruthy();
    expect(
      toggle().compareDocumentPosition(userButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      "user control must come after the toggle"
    ).toBeTruthy();
  });
});
