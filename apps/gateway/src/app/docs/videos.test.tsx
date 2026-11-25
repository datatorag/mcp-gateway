// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enhanceDocMedia } from "@/lib/docs-media";
import { DocsVideos } from "./videos";

const EMBED =
  '<iframe src="https://www.youtube.com/embed/abcDEF12345" title="Setup walkthrough" allow="autoplay; encrypted-media" allowfullscreen></iframe>';

let container: HTMLDivElement;
let page: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  page = document.createElement("div");
  // The link exactly as the docs loader writes it.
  page.innerHTML = enhanceDocMedia(EMBED, { publicDir: "/nonexistent" });
  document.body.appendChild(page);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<DocsVideos />);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  page.remove();
});

function click(target: Element, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  // jsdom cannot navigate; a click the component leaves alone is stopped here.
  target.addEventListener("click", (e) => e.preventDefault(), { once: true });
  target.dispatchEvent(event);
  return event;
}

describe("DocsVideos", () => {
  it("serves a link, not a player, until it is clicked", () => {
    expect(page.querySelector("iframe")).toBeNull();
    const link = page.querySelector("a")!;
    expect(link.href).toBe("https://www.youtube.com/watch?v=abcDEF12345");
    expect(link.textContent).toBe("Play video: Setup walkthrough");
  });

  it("replaces the link with the same video's player, playing, on a click inside it", () => {
    const label = page.querySelector("a span span")!;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    label.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(page.querySelector("a")).toBeNull();
    const player = page.querySelector("iframe")!;
    expect(player.src).toBe("https://www.youtube.com/embed/abcDEF12345?autoplay=1");
    expect(player.title).toBe("Setup walkthrough");
    expect(player.getAttribute("allow")).toBe("autoplay; encrypted-media");
    expect(player.hasAttribute("allowfullscreen")).toBe(true);
  });

  it("leaves a modified click to open the video itself", () => {
    click(page.querySelector("a")!, { metaKey: true });
    click(page.querySelector("a")!, { ctrlKey: true });
    click(page.querySelector("a")!, { button: 1 });
    expect(page.querySelector("iframe")).toBeNull();
    expect(page.querySelector("a")).not.toBeNull();
  });

  it("ignores every other link", () => {
    const other = document.createElement("a");
    other.href = "https://example.com/";
    page.appendChild(other);
    click(other);
    expect(page.querySelector("iframe")).toBeNull();
  });

  it("stops listening when it unmounts", () => {
    act(() => root.unmount());
    click(page.querySelector("a")!);
    expect(page.querySelector("iframe")).toBeNull();
    root = createRoot(container);
  });

  it("does not turn a link into a player when its address is not a video player's", () => {
    for (const bad of ["javascript:alert(1)", "https://example.com/embed/abcDEF12345", "https://www.youtube.com/watch?v=abcDEF12345"]) {
      const link = document.createElement("a");
      link.href = "https://www.youtube.com/watch?v=abcDEF12345";
      link.setAttribute("data-video-embed", bad);
      link.textContent = "Play video";
      page.appendChild(link);
      click(link);
      expect(page.contains(link), bad).toBe(true);
      link.remove();
    }
    expect(page.querySelector("iframe")).toBeNull();
  });
});
