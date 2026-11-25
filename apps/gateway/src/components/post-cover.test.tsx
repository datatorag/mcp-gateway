// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PostCover } from "./post-cover";

let container: HTMLDivElement;
let root: Root;
let reducedMotion = false;
let saveData = false;
let observed: { cb: IntersectionObserverCallback; el: Element }[] = [];
const play = vi.fn(() => Promise.resolve());
const pause = vi.fn();

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  reducedMotion = false;
  saveData = false;
  observed = [];
  play.mockClear();
  pause.mockClear();
  HTMLMediaElement.prototype.play = play;
  HTMLMediaElement.prototype.pause = pause;
  window.matchMedia = ((q: string) => ({ matches: q.includes("reduce") && reducedMotion })) as typeof window.matchMedia;
  Object.defineProperty(navigator, "connection", { configurable: true, get: () => ({ saveData }) });
  globalThis.IntersectionObserver = class {
    constructor(private cb: IntersectionObserverCallback) {}
    observe(el: Element) {
      observed.push({ cb: this.cb, el });
    }
    disconnect() {}
    unobserve() {}
    takeRecords() {
      return [];
    }
    root = null;
    rootMargin = "";
    thresholds = [];
  } as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const WITH = { title: "A post", coverImage: "/blog/a.png", coverVideo: "/blog/a-cover" };
const render = (post: Parameters<typeof PostCover>[0]["post"]) => act(() => root.render(<PostCover post={post} />));
const video = () => container.querySelector<HTMLVideoElement>("video");
const scroll = (isIntersecting: boolean) =>
  act(() => observed.forEach(({ cb, el }) => cb([{ isIntersecting, target: el } as IntersectionObserverEntry], {} as IntersectionObserver)));

describe("a post's cover", () => {
  it("is the cover image alone when the post has no video, as it always was", () => {
    render({ title: "A post", coverImage: "/blog/a.png" });
    expect(video()).toBeNull();
    const img = container.querySelector("img")!;
    expect(img.getAttribute("alt")).toBe("A post");
    expect(img.getAttribute("width")).toBe("1200");
    expect(img.getAttribute("height")).toBe("630");
    expect(observed).toEqual([]);
  });

  it("is nothing when the post has no cover image, even with a video named", () => {
    render({ title: "A post", coverVideo: "/blog/a-cover" });
    expect(container.innerHTML).toBe("");
  });

  it("lays the video over the image, which is its poster: both sources, muted, looping, inline, no controls", () => {
    render(WITH);
    const v = video()!;
    expect([...v.querySelectorAll("source")].map((s) => [s.getAttribute("src"), s.getAttribute("type")])).toEqual([
      ["/blog/a-cover.webm", 'video/webm; codecs="vp9"'],
      ["/blog/a-cover.mp4", "video/mp4"],
    ]);
    // The still is the image under it, not a second download of the same file.
    expect(v.hasAttribute("poster")).toBe(false);
    expect(container.querySelector("img")!.getAttribute("src")).toContain("a.png");
    expect(v.muted).toBe(true);
    expect(v.loop).toBe(true);
    expect(v.playsInline).toBe(true);
    expect(v.hasAttribute("controls")).toBe(false);
    // The image is still there under it, and still sizes the box.
    expect(container.querySelector("img")!.getAttribute("height")).toBe("630");
    expect(v.className).toContain("absolute");
  });

  it("asks the browser for nothing in the served HTML: no autoplay, and no preload", () => {
    render(WITH);
    expect(video()!.hasAttribute("autoplay")).toBe(false);
    expect(video()!.getAttribute("preload")).toBe("none");
    expect(play).not.toHaveBeenCalled();
  });

  it("plays once the cover is on screen and pauses when it leaves", () => {
    render(WITH);
    scroll(true);
    expect(play).toHaveBeenCalledTimes(1);
    scroll(false);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it("stays invisible until it is really playing", () => {
    render(WITH);
    expect(video()!.className).toContain("opacity-0");
    act(() => video()!.dispatchEvent(new Event("playing")));
    expect(video()!.className).toContain("opacity-100");
  });

  it("never starts for a visitor who asked for reduced motion, or for less data", () => {
    reducedMotion = true;
    render(WITH);
    expect(observed).toEqual([]);
    act(() => root.unmount());
    root = createRoot(container);
    reducedMotion = false;
    saveData = true;
    render(WITH);
    expect(observed).toEqual([]);
    expect(play).not.toHaveBeenCalled();
  });

  it("leaves the image when no format can be loaded or played", () => {
    render(WITH);
    act(() => video()!.querySelector("source:last-of-type")!.dispatchEvent(new Event("error")));
    expect(video()).toBeNull();
    expect(container.querySelector("img")).not.toBeNull();
  });

  it("describes the cover on the image, from the post's own words when it gives them, and hides the video from screen readers", () => {
    render({ ...WITH, coverAlt: "Three inboxes merging into one list" });
    expect(container.querySelector("img")!.getAttribute("alt")).toBe("Three inboxes merging into one list");
    expect(video()!.getAttribute("aria-hidden")).toBe("true");
    expect(video()!.getAttribute("tabindex")).toBe("-1");
  });
});

describe("a post's animated SVG cover", () => {
  const ANIMATED = { title: "A post", coverImage: "/blog/a.png", coverAnimation: "/blog/a-cover.svg" };
  const animation = () => container.querySelector<HTMLImageElement>("[data-cover-animation]");
  const still = () => container.querySelector<HTMLImageElement>("img:not([data-cover-animation])")!;

  it("is a plain image of the file, over the still, never the file's markup in the page", () => {
    render(ANIMATED);
    const a = animation()!;
    expect(a.tagName).toBe("IMG");
    expect(a.getAttribute("src")).toBe("/blog/a-cover.svg");
    expect(a.className).toContain("absolute");
    expect(container.querySelector("svg, object, embed, iframe")).toBeNull();
    // The still is under it and still sizes the box.
    expect(still().getAttribute("height")).toBe("630");
    expect(video()).toBeNull();
  });

  it("has no element in the served HTML that loads the file, so nothing is requested before the page has painted", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const html = renderToStaticMarkup(<PostCover post={ANIMATED} />);
    expect(html).not.toContain("a-cover.svg");
    expect(html).toContain("a.png");
  });

  it("is never requested for a visitor who asked for reduced motion, or for less data", () => {
    reducedMotion = true;
    render(ANIMATED);
    expect(animation()).toBeNull();
    expect(container.innerHTML).not.toContain("a-cover.svg");
    act(() => root.unmount());
    root = createRoot(container);
    reducedMotion = false;
    saveData = true;
    render(ANIMATED);
    expect(animation()).toBeNull();
    expect(still()).not.toBeNull();
  });

  it("stays invisible until it has loaded, and leaves the still when it fails", () => {
    render(ANIMATED);
    expect(animation()!.className).toContain("opacity-0");
    act(() => animation()!.dispatchEvent(new Event("load")));
    expect(animation()!.className).toContain("opacity-100");
    act(() => animation()!.dispatchEvent(new Event("error")));
    expect(animation()).toBeNull();
    expect(still()).not.toBeNull();
  });

  it("is described once, on the still, and is itself hidden from screen readers", () => {
    render({ ...ANIMATED, coverAlt: "Three inboxes merging into one list" });
    expect(still().getAttribute("alt")).toBe("Three inboxes merging into one list");
    expect(animation()!.getAttribute("alt")).toBe("");
    expect(animation()!.getAttribute("aria-hidden")).toBe("true");
  });

  it("shows the animation, not the video, if a post names both", () => {
    render({ ...ANIMATED, coverVideo: "/blog/a-cover" });
    expect(animation()).not.toBeNull();
    expect(video()).toBeNull();
  });

  it("ignores a value that is not a /blog/ .svg path", () => {
    render({ ...ANIMATED, coverAnimation: "https://x.test/a.svg" });
    expect(animation()).toBeNull();
    expect(container.innerHTML).not.toContain("x.test");
  });
});
