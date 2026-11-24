// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { buildSiteNav } from "@/lib/site-nav";

const capture = vi.fn();
vi.mock("posthog-js", () => ({ default: { capture: (...a: unknown[]) => capture(...a) } }));
let user: { id: string } | null = null;
vi.mock("@/lib/use-current-user", () => ({ useCurrentUser: () => user }));

const { NavbarClient } = await import("./navbar-client");

const nav = buildSiteNav([{ slug: "two-accounts", title: "Two accounts, one prompt", menuLine: "A summary.", marks: ["gmail", "gmail"] }]);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  capture.mockClear();
  user = null;
  act(() => root.render(<NavbarClient nav={nav} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.style.overflow = "";
});

const desktop = () => container.querySelector<HTMLElement>('nav[aria-label="Main"]')!;
const button = (id: string) => desktop().querySelector<HTMLButtonElement>(`[data-nav-group="${id}"]`)!;
const panel = (id: string) => desktop().querySelector<HTMLElement>(`[data-nav-panel="${id}"]`)!;
const openPanels = () =>
  [...desktop().querySelectorAll<HTMLElement>("[data-nav-panel]")].filter((p) => !p.hidden).map((p) => p.dataset.navPanel);
const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const key = (name: string) =>
  act(() => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })));
const focused = () => {
  const el = document.activeElement as HTMLElement;
  return el.dataset.navGroup ?? el.dataset.navItem;
};

describe("the navbar's panels", () => {
  it("are disclosures: a button that says whether its panel is open, real links inside, and no menu roles", () => {
    for (const group of nav.groups) {
      const b = button(group.id);
      expect(b.tagName).toBe("BUTTON");
      expect(b.getAttribute("aria-expanded")).toBe("false");
      expect(document.getElementById(b.getAttribute("aria-controls")!)).toBe(panel(group.id));
      expect(panel(group.id).hidden).toBe(true);
    }
    expect(container.querySelectorAll('[role="menu"], [role="menuitem"], [role="menubar"]').length).toBe(0);
    // Every item is in the page from the first render, so opening a panel moves nothing.
    expect(panel("product").querySelectorAll("a[href]").length).toBe(9);
  });

  it("open on a press, one at a time, and close on a second press", () => {
    click(button("product"));
    expect(openPanels()).toEqual(["product"]);
    expect(button("product").getAttribute("aria-expanded")).toBe("true");
    click(button("resources"));
    expect(openPanels()).toEqual(["resources"]);
    expect(button("product").getAttribute("aria-expanded")).toBe("false");
    click(button("resources"));
    expect(openPanels()).toEqual([]);
  });

  it("do not open on hover", () => {
    act(() => {
      button("product").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      button("product").dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    });
    expect(openPanels()).toEqual([]);
  });

  it("close on Escape with focus back on the button, and on a press outside", () => {
    click(button("solutions"));
    act(() => panel("solutions").querySelector<HTMLElement>("a")!.focus());
    key("Escape");
    expect(openPanels()).toEqual([]);
    expect(focused()).toBe("solutions");

    click(button("solutions"));
    act(() => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(openPanels()).toEqual([]);
  });

  it("close when focus leaves the navigation", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    click(button("product"));
    act(() => panel("product").querySelector<HTMLElement>("a")!.focus());
    act(() => outside.focus());
    expect(openPanels()).toEqual([]);
    outside.remove();
  });

  it("stay open on a blur that goes nowhere, so a link pressed with the mouse is still there for its click", () => {
    click(button("product"));
    act(() => button("product").focus());
    act(() => button("product").dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null })));
    expect(openPanels()).toEqual(["product"]);
  });

  it("move with the arrow keys: left and right along the bar, up and down through a panel", () => {
    act(() => button("product").focus());
    key("ArrowRight");
    expect(focused()).toBe("solutions");
    key("ArrowLeft");
    key("ArrowLeft");
    expect(focused()).toBe("pricing");

    click(button("product"));
    const links = [...panel("product").querySelectorAll<HTMLElement>("a")];
    act(() => links[0].focus());
    key("ArrowDown");
    expect(focused()).toBe(links[1].dataset.navItem);
    key("End");
    expect(focused()).toBe(links.at(-1)!.dataset.navItem);
    key("ArrowDown");
    expect(focused()).toBe(links[0].dataset.navItem);
    key("ArrowUp");
    expect(focused()).toBe(links.at(-1)!.dataset.navItem);
    key("Home");
    expect(focused()).toBe(links[0].dataset.navItem);
  });

  it("leave a key pressed with a modifier alone", () => {
    act(() => button("product").focus());
    act(() =>
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", metaKey: true, bubbles: true }))
    );
    expect(focused()).toBe("product");
  });
});

describe("the navbar's links", () => {
  it("send one event, with the group and the item, and close the panel", () => {
    click(button("solutions"));
    const link = panel("solutions").querySelector<HTMLAnchorElement>('[data-nav-item="agent-claude-code"]')!;
    link.addEventListener("click", (e) => e.preventDefault());
    click(link);
    expect(capture.mock.calls).toEqual([["nav_item_clicked", { group: "solutions", item: "agent-claude-code" }]]);
    expect(openPanels()).toEqual([]);
  });

  it("open the repository in a new tab and keep every other item on the site", () => {
    const off = [...desktop().querySelectorAll<HTMLAnchorElement>("a[target=_blank]")];
    expect(off.map((a) => a.dataset.navItem)).toEqual(["open-source"]);
    expect(off[0].rel).toBe("noopener noreferrer");
  });

  it("load the page for an address that carries a choice, since the block reading it reads it once", () => {
    const full = [...desktop().querySelectorAll<HTMLAnchorElement>("[data-nav-full-load]")];
    expect(full.length).toBeGreaterThan(0);
    expect(full.every((a) => a.getAttribute("href")!.startsWith("/add-to-your-agent?client="))).toBe(true);
    const queried = [...desktop().querySelectorAll<HTMLAnchorElement>("a[data-nav-item]")].filter((a) => a.getAttribute("href")!.includes("?"));
    expect(queried).toEqual(full);
  });

  it("ring a stacked mark in the row's own background, at rest and hovered, so no outline shows on hover", () => {
    const row = desktop().querySelector<HTMLAnchorElement>('[data-nav-item="for-two-accounts"]')!;
    const front = row.querySelector<HTMLElement>("[data-service-marks]")!.children[1];
    // The row sets one variable; its hover background and the ring both read it.
    expect(front.className).toContain("ring-[var(--nav-row)]");
    expect(row.className).toContain("[--nav-row:#0b1220]");
    expect(row.className).toContain("hover:[--nav-row:#232a36]");
    expect(row.className).toContain("hover:bg-[var(--nav-row)]");
    expect(row.className).toContain("focus-visible:[--nav-row:#232a36]");
    expect(row.className).toContain("focus-visible:bg-[var(--nav-row)]");
    // No second, fixed color for either.
    expect(row.className).not.toMatch(/hover:bg-white/);
    expect(front.className).not.toMatch(/ring-\[#/);
  });

  it("show Log in and Get Started to a visitor, both starting sign-in, and never link to the login page", () => {
    const end = [...desktop().querySelectorAll<HTMLAnchorElement>("a")].filter((a) => !a.dataset.navItem);
    expect(end.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Log in", "/auth/google"],
      ["Get Started", "/auth/google"],
    ]);
    expect(container.innerHTML).not.toContain("/auth/login");
  });

  it("show a signed-in visitor one button, into the agent", () => {
    user = { id: "u1" };
    act(() => root.render(<NavbarClient nav={nav} />));
    const end = [...desktop().querySelectorAll<HTMLAnchorElement>("a")].filter((a) => !a.dataset.navItem);
    expect(end.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([["Open Agent", "/dashboard/agent"]]);
  });
});

describe("the phone sheet", () => {
  const toggle = () => container.querySelector<HTMLButtonElement>('button[aria-controls$="-sheet"]')!;
  const sheet = () => container.querySelector<HTMLElement>("[data-nav-sheet]");
  const section = (id: string) => sheet()!.querySelector<HTMLButtonElement>(`[data-nav-section="${id}"]`)!;

  it("opens from the toggle, holds the page behind it still, and closes on Escape", () => {
    expect(sheet()).toBeNull();
    expect(toggle().getAttribute("aria-label")).toBe("Open menu");
    click(toggle());
    expect(sheet()).not.toBeNull();
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(toggle().getAttribute("aria-label")).toBe("Close menu");
    expect(document.body.style.overflow).toBe("hidden");
    act(() => sheet()!.querySelector<HTMLElement>("button")!.focus());
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(toggle());
    expect(document.body.style.overflow).toBe("");
  });

  it("has the three groups as sections that expand one at a time, then the plain links and the account buttons", () => {
    click(toggle());
    expect([...sheet()!.querySelectorAll("[data-nav-section]")].map((b) => b.getAttribute("aria-expanded"))).toEqual([
      "false",
      "false",
      "false",
    ]);
    click(section("product"));
    click(section("resources"));
    expect(section("product").getAttribute("aria-expanded")).toBe("false");
    expect(section("resources").getAttribute("aria-expanded")).toBe("true");
    const region = document.getElementById(section("resources").getAttribute("aria-controls")!)!;
    expect(region.hidden).toBe(false);
    expect([...region.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([
      "/blog",
      "/changelog",
      "/docs",
      "/faq",
      "/contact",
    ]);
    const rest = [...sheet()!.querySelectorAll<HTMLAnchorElement>(":scope > ul > li > a, :scope > div > a")];
    expect(rest.map((a) => a.textContent)).toEqual(["Docs", "Pricing", "Log in", "Get Started"]);
  });

  it("holds every item the desktop panels hold", () => {
    click(toggle());
    const ids = (root: Element) => [...root.querySelectorAll<HTMLElement>("[data-nav-item]")].map((a) => a.dataset.navItem).sort();
    expect(ids(sheet()!)).toEqual(ids(desktop()));
  });

  it("sends the same event and closes on a link", () => {
    click(toggle());
    click(section("product"));
    const link = sheet()!.querySelector<HTMLAnchorElement>('[data-nav-item="status"]')!;
    link.addEventListener("click", (e) => e.preventDefault());
    click(link);
    expect(capture.mock.calls).toEqual([["nav_item_clicked", { group: "product", item: "status" }]]);
    expect(sheet()).toBeNull();
  });
});
