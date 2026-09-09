// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PROMO_DISMISSED_KEY } from "@/lib/promo";

const capture = vi.fn();
vi.mock("posthog-js", () => ({ default: { capture: (...a: unknown[]) => capture(...a) } }));
let pathname = "/skills/morning-brief";
let search = "";

const { PromoBanner } = await import("./promo-banner");

let container: HTMLDivElement;
let root: Root;
const BEFORE = new Date("2026-10-01T12:00:00Z");
const AFTER = new Date("2026-12-07T00:00:01Z");

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  capture.mockClear();
  localStorage.clear();
  pathname = "/skills/morning-brief";
  search = "";
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (props: Partial<Parameters<typeof PromoBanner>[0]> = {}) => {
  // The banner reads the URL from the window; put the page there first.
  window.history.replaceState(null, "", pathname + (search ? `?${search}` : ""));
  act(() => {
    root.render(<PromoBanner now={BEFORE} {...props} />);
  });
};
const link = () => container.querySelector('a[href="/pricing?promo=DTR50"]');
const dismiss = () => Array.from(container.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === "Dismiss");

/* SCRUM-231: one banner, three mount points, decided on the client. */
describe("PromoBanner", () => {
  it("shows both windows of the copy and links to pricing with the code, before the end date", () => {
    render();
    expect(container.textContent).toContain("50% off Pro for a year with code DTR50");
    expect(container.textContent).toContain("Redeem by December 6");
    expect(link()).toBeTruthy();
  });

  it("renders nothing after the end date under the injected clock, with no deploy", () => {
    render({ now: AFTER });
    expect(container.textContent).toBe("");
    expect(link()).toBeNull();
  });

  it("dismisses with a memory for the campaign, and a browser with that memory sees nothing on mount", () => {
    render();
    act(() => {
      dismiss()!.click();
    });
    expect(link()).toBeNull();
    expect(localStorage.getItem(PROMO_DISMISSED_KEY)).toBe("1");
    act(() => root.unmount());
    root = createRoot(container);
    render();
    expect(link()).toBeNull();
  });

  it("a visit carrying the code in the URL clears the memory, so a click-through from the ad always sees it", () => {
    localStorage.setItem(PROMO_DISMISSED_KEY, "1");
    search = "promo=DTR50";
    render();
    expect(link()).toBeTruthy();
    expect(localStorage.getItem(PROMO_DISMISSED_KEY)).toBeNull();
  });

  it("reports one click with the code and the page it was clicked from, and nothing on show", () => {
    render();
    expect(capture).not.toHaveBeenCalled();
    act(() => {
      link()!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith("promo_banner_clicked", { code: "DTR50", page: "/skills/morning-brief" });
  });

  it("in the dashboard variant, hides for a paying customer and shows for a free one", () => {
    render({ variant: "dashboard", plan: "pro" });
    expect(link()).toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    render({ variant: "dashboard", plan: "free" });
    expect(link()).toBeTruthy();
  });

  it("in the dashboard variant, shows nothing until the plan is known", () => {
    render({ variant: "dashboard", plan: null });
    expect(link()).toBeNull();
  });
});
