// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { UseCase } from "@/lib/use-cases";
import { replayTimeline } from "./replay-timeline";
import { UseCaseReplay, frameHeight } from "./use-case-replay";

const USE_CASE: UseCase = {
  slug: "a-use-case",
  title: "File a thread as an issue",
  outcome: "Your agent files it.",
  description: "x".repeat(130),
  date: "2026-11-25",
  services: ["gmail", "jira"],
  accounts: "single",
  prompt: "Find the thread and file it.",
  steps: [
    { tool: "gws-mcp__gmail_search", label: "Find the thread" },
    { tool: "atlassian-mcp__jira_create_issue", label: "Create the issue" },
  ],
  answer: "I filed it.",
  result: { kind: "created", what: "Jira issue", title: "ABC-1: A bug", lines: ["Type: Bug."] },
};

let container: HTMLDivElement;
let root: Root;
let reducedMotion = false;
let observed: Set<IntersectionObserverCallback> = new Set();

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  reducedMotion = false;
  observed = new Set();
  window.matchMedia = ((q: string) => ({ matches: q.includes("reduce") && reducedMotion })) as typeof window.matchMedia;
  globalThis.IntersectionObserver = class {
    constructor(private cb: IntersectionObserverCallback) {}
    observe() {
      observed.add(this.cb);
    }
    disconnect() {
      observed.delete(this.cb);
    }
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
  vi.useRealTimers();
});

const render = () => act(() => root.render(<UseCaseReplay useCase={USE_CASE} />));
const state = () => container.querySelector<HTMLElement>("[data-use-case-replay]")!.dataset.useCaseReplay;
const onScreen = () => act(() => observed.forEach((cb) => cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)));
const button = (name: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);
const total = replayTimeline(USE_CASE).reduce((ms, f) => ms + f.holdMs, 0);
// A frame's timer is set by the effect of the frame before it, so time is
// advanced a little at a time, with React settling in between.
const run = (ms: number) => {
  for (let elapsed = 0; elapsed < ms; elapsed += 20) act(() => void vi.advanceTimersByTime(20));
};
const text = () => container.textContent ?? "";
/** Run the clock until something is true, or fail if it never is. */
const runUntil = (what: () => boolean) => {
  for (let elapsed = 0; elapsed < total * 6 && !what(); elapsed += 20) act(() => void vi.advanceTimersByTime(20));
  expect(what()).toBe(true);
};
const stepsShown = () => container.querySelectorAll("[data-replay-steps] li").length;

describe("the chat replay", () => {
  it("is the finished conversation in the server's HTML: the prompt, every step's label and real tool name, and the result, as real text", () => {
    const html = renderToStaticMarkup(<UseCaseReplay useCase={USE_CASE} />);
    for (const words of ["Find the thread and file it.", "Find the thread", "gmail_search", "Create the issue", "jira_create_issue", "I filed it.", "ABC-1: A bug", "Type: Bug."]) {
      expect(html, words).toContain(words);
    }
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<textarea");
  });

  it("rests on the finished conversation until it is on screen, then plays once from an empty prompt", () => {
    render();
    expect(state()).toBe("finished");
    expect(text()).toContain("ABC-1: A bug");
    onScreen();
    expect(state()).toBe("playing");
    expect(text()).not.toContain("ABC-1: A bug");
    expect(text()).not.toContain("Find the thread and file it.");
  });

  it("types the prompt, shows the steps one at a time, then the answer and the result, and stops at the end without looping", () => {
    render();
    onScreen();
    runUntil(() => stepsShown() === 1);
    expect(text()).toContain("Find the thread and file it.");
    expect(text()).not.toContain("Create the issue");
    expect(text()).not.toContain("I filed it.");
    runUntil(() => stepsShown() === 2);
    expect(text()).not.toContain("I filed it.");
    runUntil(() => state() === "finished");
    expect(text()).toContain("Type: Bug.");
    // Being on screen again does not start it a second time.
    onScreen();
    run(total);
    expect(state()).toBe("finished");
  });

  it("pauses and goes on from where it was, and replays from the start on request", () => {
    render();
    onScreen();
    run(200);
    act(() => button("Pause")!.click());
    expect(state()).toBe("paused");
    const frozen = text();
    run(total);
    expect(text()).toBe(frozen);
    act(() => button("Play")!.click());
    runUntil(() => state() === "finished");
    act(() => button("Replay")!.click());
    expect(state()).toBe("playing");
    expect(text()).not.toContain("ABC-1: A bug");
  });

  it("has one height for the whole replay, worked out from the record and bounded", () => {
    render();
    const box = () => container.querySelector<HTMLElement>("[data-use-case-replay] > div:last-child")!;
    const resting = box().style.height;
    expect(resting).toBe(frameHeight(USE_CASE));
    onScreen();
    expect(box().style.height).toBe(resting);
    runUntil(() => state() === "finished");
    expect(box().style.height).toBe(resting);
    const many = { steps: Array.from({ length: 40 }, () => USE_CASE.steps[0]), result: USE_CASE.result };
    expect(frameHeight(many)).toBe("46rem");
    expect(frameHeight({ steps: [USE_CASE.steps[0]], result: { kind: "text", lines: ["a"] } })).toBe("20rem");
  });

  it("never moves with reduced motion: the finished conversation, and no play, pause, or replay", () => {
    reducedMotion = true;
    render();
    onScreen();
    run(total);
    expect(state()).toBe("finished");
    expect(text()).toContain("Type: Bug.");
    expect(button("Replay")).toBeUndefined();
    expect(button("Pause")).toBeUndefined();
  });
});
