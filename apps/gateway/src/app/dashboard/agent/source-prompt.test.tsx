// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SOURCE_PROMPT_COPY, SourcePrompt } from "./source-prompt";

/**
 * SCRUM-480: the prompt as a person meets it. Its words, Continue sending the
 * answer, and every other way out (Skip, Escape) sending a skip, each once.
 */

let root: Root;
let host: HTMLDivElement;
const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response("{}"));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function open() {
  await act(async () => root.render(<SourcePrompt />));
}

const sent = () => fetchMock.mock.calls.map(([url, init]) => [url, JSON.parse(String(init?.body))]);
const button = (text: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement;

describe("the source prompt (SCRUM-480)", () => {
  it("says what it asks, in these words, with no em dash", async () => {
    await open();
    expect(document.body.textContent).toContain("Hi there! How did you find DataToRAG?");
    const box = document.querySelector("textarea")!;
    expect(box.placeholder).toBe("Be as specific as you want");
    expect(box.maxLength).toBe(500);
    expect(button("Continue")).toBeTruthy();
    expect(button("Skip")).toBeTruthy();
    expect(Object.values(SOURCE_PROMPT_COPY).join(" ")).not.toMatch(/[\u2013\u2014]/);
  });

  it("Continue waits for an answer, then sends it once and closes", async () => {
    await open();
    expect(button("Continue").disabled).toBe(true);
    const box = document.querySelector("textarea")!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      set.call(box, "a newsletter");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Continue").click());
    expect(sent()).toEqual([["/api/me/self-report", { answer: "a newsletter" }]]);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("Skip is one click and sends a skip", async () => {
    await open();
    await act(async () => button("Skip").click());
    expect(sent()).toEqual([["/api/me/self-report", { skipped: true }]]);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("Escape is a skip too, so no way out leaves the prompt unsettled", async () => {
    await open();
    await act(async () => {
      document.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(sent()).toEqual([["/api/me/self-report", { skipped: true }]]);
  });
});
