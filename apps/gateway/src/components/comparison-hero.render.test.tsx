// @vitest-environment jsdom

/**
 * The comparison hero's motion (SCRUM-425): it plays a group at a time, holds
 * still under prefers-reduced-motion and while hovered or focused, lets a
 * keyboard reader step the groups, and names the Slides date when a Slides row
 * is in it. Driven with fake timers against the real component.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

let reduce = false;
vi.stubGlobal("matchMedia", (query: string) => ({
  matches: query.includes("reduce") ? reduce : false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
}));

const { ComparisonHero, GROUP_REST_MS, ROW_EVERY_MS, RESOLVE_MS } = await import("./comparison-hero");
const { heroGroups } = await import("./connector-comparison");

let container: HTMLDivElement;
let root: Root;

function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <ComparisonHero groups={heroGroups()} verifiedOn="15 October 2026" slidesVerifiedOn="9 October 2026" />
    )
  );
  return container;
}

/** The table on show: the one carrying the caption. The others are laid out
 * in the same cell, invisible and hidden from assistive tech. */
const current = () => container.querySelector("caption")!.closest("table")!;
const heading = () => current().querySelector("thead th")!.textContent;
const rowLabels = () =>
  [...current().querySelectorAll("tbody tr:not(.invisible) th")].map((th) => th.textContent);
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  reduce = false;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("the comparison hero", () => {
  it("opens on the first group complete, then plays the next group a row at a time", () => {
    mount();
    const [first, second] = heroGroups();
    expect(heading()).toBe(first.label);
    expect(rowLabels()).toHaveLength(first.rows.length);
    advance(GROUP_REST_MS);
    expect(heading()).toBe(second.label);
    expect(rowLabels()).toHaveLength(0);
    advance(ROW_EVERY_MS);
    expect(rowLabels()).toHaveLength(1);
    advance(RESOLVE_MS);
    advance(ROW_EVERY_MS);
    expect(rowLabels()).toHaveLength(2);
  });

  it("keeps one height as it cycles: every group's whole table is laid out in one cell", () => {
    // jsdom does no layout, so this holds the cause and the browser check
    // holds the height. Every group, every row, always in the DOM; only the
    // current table is visible or read.
    mount();
    const groups = heroGroups();
    const check = () => {
      const tables = [...container.querySelectorAll("table")];
      expect(tables).toHaveLength(groups.length);
      tables.forEach((t, i) => expect(t.querySelectorAll("tbody tr"), groups[i].label).toHaveLength(groups[i].rows.length));
      expect(tables.filter((t) => !t.classList.contains("invisible"))).toHaveLength(1);
      // Invisible, never removed from layout: `hidden` or display none would
      // let the box shrink to the current group again.
      expect(tables.filter((t) => t.hidden || t.style.display === "none")).toHaveLength(0);
      expect(tables.filter((t) => t.getAttribute("aria-hidden") !== "true")).toHaveLength(1);
      expect(container.querySelectorAll("caption")).toHaveLength(1);
    };
    check();
    advance(GROUP_REST_MS);
    advance(ROW_EVERY_MS);
    check();
  });

  it("under reduced motion shows the first group complete and never moves", () => {
    reduce = true;
    mount();
    const [first] = heroGroups();
    advance(GROUP_REST_MS * 5);
    expect(heading()).toBe(first.label);
    expect(rowLabels()).toHaveLength(first.rows.length);
  });

  it("holds still while hovered", () => {
    mount();
    const [first] = heroGroups();
    act(() => {
      container.firstElementChild!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    advance(GROUP_REST_MS * 3);
    expect(heading()).toBe(first.label);
  });

  it("steps the groups from the dots with the arrow keys, and holds still while focused", () => {
    mount();
    const groups = heroGroups();
    const dots = () => [...container.querySelectorAll<HTMLButtonElement>("button")];
    expect(dots()).toHaveLength(groups.length);
    act(() => dots()[0].focus());
    act(() => {
      dots()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(heading()).toBe(groups[1].label);
    expect(rowLabels()).toHaveLength(groups[1].rows.length);
    expect(document.activeElement).toBe(dots()[1]);
    advance(GROUP_REST_MS * 3);
    expect(heading()).toBe(groups[1].label);
  });

  it("names both dates, because a Slides row is in it, and links to the full table", () => {
    mount();
    const link = container.querySelector<HTMLAnchorElement>('a[href="#comparison"]')!;
    expect(link.textContent).toContain("15 October 2026");
    expect(link.textContent).toContain("Google Slides on 9 October 2026");
  });

  it("says Yes and No in words to a screen reader once a row resolves", () => {
    mount();
    const first = current().querySelector("tbody tr")!;
    expect([...first.querySelectorAll(".sr-only")].map((s) => s.textContent)).toEqual(["No", "Yes"]);
  });
});
