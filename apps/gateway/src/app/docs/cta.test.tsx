// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { PROMO_DISMISSED_KEY, promoCopy } from "@/lib/promo";

const capture = vi.fn();
vi.mock("posthog-js", () => ({ default: { capture: (...a: unknown[]) => capture(...a) } }));
vi.mock("next/navigation", () => ({ usePathname: () => "/docs/gmail" }));

const { DocsCta } = await import("./cta");

let container: HTMLDivElement;
let root: Root;
const BEFORE = new Date("2026-10-01T12:00:00Z");
const AFTER = new Date("2026-12-07T00:00:01Z");
const HEADLINE = promoCopy().headline;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  // jsdom cannot navigate; the click is observed, never followed.
  container.addEventListener("click", (e) => e.preventDefault());
  document.body.appendChild(container);
  root = createRoot(container);
  capture.mockClear();
  localStorage.clear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (props: Parameters<typeof DocsCta>[0]) => {
  act(() => {
    root.render(<DocsCta {...props} />);
  });
};
const button = () => container.querySelector('a[href="/auth/login"]') as HTMLAnchorElement;
const click = () => act(() => button().dispatchEvent(new MouseEvent("click", { bubbles: true })));

/* SCRUM-287: on docs the campaign copy lives inside the sidebar button. */
describe("DocsCta sidebar", () => {
  it("while the promo is active, reads 'Get started free' and the banner's headline under it, and still goes to sign-in", () => {
    render({ variant: "sidebar", now: BEFORE });
    expect(button().textContent).toContain("Get started free");
    expect(button().textContent).toContain(HEADLINE);
    // The promo line is a second, smaller line, not part of the first.
    expect(button().querySelector("span")?.textContent).toBe(HEADLINE);
    expect(button().getAttribute("href")).toBe("/auth/login");
  });

  it("after the end date under the injected clock, is the plain button with no promo words", () => {
    render({ variant: "sidebar", now: AFTER });
    expect(button().textContent).toBe("Get started free");
    expect(button().querySelector("span")).toBeNull();
  });

  it("ignores the banner's dismissal memory, because this button has no dismiss control", () => {
    localStorage.setItem(PROMO_DISMISSED_KEY, "1");
    render({ variant: "sidebar", now: BEFORE });
    expect(button().textContent).toContain(HEADLINE);
  });

  it("renders no promo words on the server, so a prerendered docs page never freezes the date's answer", () => {
    const html = renderToString(<DocsCta variant="sidebar" now={BEFORE} />);
    expect(html).toContain("Get started free");
    expect(html).not.toContain(HEADLINE);
  });

  it("keeps cta: get_started and the page, and says whether the promo line was showing", () => {
    render({ variant: "sidebar", now: BEFORE });
    click();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith("docs_cta_clicked", { cta: "get_started", page: "/docs/gmail", promo: true });

    capture.mockClear();
    act(() => root.unmount());
    root = createRoot(container);
    render({ variant: "sidebar", now: AFTER });
    click();
    expect(capture).toHaveBeenCalledWith("docs_cta_clicked", { cta: "get_started", page: "/docs/gmail", promo: false });
  });
});

describe("DocsCta, the surfaces SCRUM-287 leaves alone", () => {
  it("the mobile pill stays 'Sign in' with its own event, even while the promo is active", () => {
    render({ variant: "mobile", now: BEFORE });
    expect(button().textContent).toBe("Sign in");
    click();
    expect(capture).toHaveBeenCalledWith("docs_cta_clicked", { cta: "sign_in", page: "/docs/gmail" });
  });

  it("the end-of-page CTA carries no promo words and keeps its own event", () => {
    render({ variant: "inline", now: BEFORE });
    expect(container.textContent).not.toContain(HEADLINE);
    click();
    expect(capture).toHaveBeenCalledWith("docs_cta_clicked", { cta: "inline_end", page: "/docs/gmail" });
  });
});
