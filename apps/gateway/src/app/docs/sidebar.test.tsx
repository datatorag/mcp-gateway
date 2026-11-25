// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const location = vi.hoisted(() => ({ pathname: "/docs/gmail" }));
vi.mock("next/navigation", () => ({ usePathname: () => location.pathname }));

const { DocsSidebar } = await import("./sidebar");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const GROUPS = [
  {
    connector: { id: "google-workspace", title: "Google Workspace", slug: "google-workspace" },
    overview: { slug: "google-workspace", title: "Google Workspace" },
    pages: [{ slug: "gmail", title: "Gmail" }],
  },
  {
    connector: { id: "notion", title: "Notion", slug: "notion" },
    overview: { slug: "notion", title: "Notion" },
    pages: [],
  },
];

const toggles = () => Array.from(container.querySelectorAll("button"));

describe("DocsSidebar connector groups", () => {
  beforeEach(() => {
    act(() => {
      root.render(<DocsSidebar topLevel={[]} groups={GROUPS} />);
    });
  });

  it("shows a collapse control only for a connector that has child pages", () => {
    // Notion is an overview with nothing under it: a control there did nothing.
    expect(toggles()).toHaveLength(1);
    expect(container.querySelector('a[href="/docs/notion"]')).not.toBeNull();
  });

  it("collapses and expands the child pages, and says which it will do", () => {
    const [toggle] = toggles();
    expect(toggle.getAttribute("aria-label")).toBe("Collapse");
    expect(container.querySelector('a[href="/docs/gmail"]')).not.toBeNull();

    act(() => toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(toggle.getAttribute("aria-label")).toBe("Expand");
    expect(container.querySelector('a[href="/docs/gmail"]')).toBeNull();
  });
});

describe("DocsSidebar fixed links", () => {
  const render = (pathname: string) => {
    location.pathname = pathname;
    act(() => {
      root.render(<DocsSidebar topLevel={[{ slug: "getting-started", title: "Getting Started" }]} groups={GROUPS} />);
    });
  };
  const link = (href: string) => container.querySelector(`a[href="${href}"]`);
  const active = (href: string) => link(href)?.className.includes("font-medium") ?? false;

  afterEach(() => {
    location.pathname = "/docs/gmail";
  });

  it("links the docs index first and the all-tools page, beside the pages", () => {
    render("/docs/gmail");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/docs");
    expect(link("/docs/tools")?.textContent).toBe("All tools");
    expect(active("/docs")).toBe(false);
    expect(active("/docs/tools")).toBe(false);
  });

  it("marks the index and the all-tools page as the current page only on their own address", () => {
    render("/docs");
    expect(active("/docs")).toBe(true);
    expect(active("/docs/tools")).toBe(false);
    expect(active("/docs/getting-started")).toBe(false);

    render("/docs/tools");
    expect(active("/docs/tools")).toBe(true);
    expect(active("/docs")).toBe(false);
  });
});
