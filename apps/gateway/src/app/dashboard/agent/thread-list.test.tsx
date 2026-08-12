// @vitest-environment jsdom

/**
 * The conversations rail's own behaviour, which is not covered by anything
 * that mounts the chat: what it shows, and what it does when a delete fails.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThreadList, relativeTime } from "./thread-list";

let container: HTMLDivElement;
let root: Root;

const THREADS = [
  { id: "t1", title: "Summarize my Drive", updatedAt: new Date().toISOString() },
  { id: "t2", title: "Chat on Aug 3", updatedAt: new Date(Date.now() - 90_000_000).toISOString() },
];

function stubFetch(deleteOk: boolean) {
  return vi.fn(async (url: string, init?: { method?: string }) => {
    if (init?.method === "DELETE") {
      return new Response(JSON.stringify(deleteOk ? { deleted: true } : { error: "Not found" }), {
        status: deleteOk ? 200 : 404,
      });
    }
    if (String(url).includes("/api/playground/threads")) {
      return new Response(JSON.stringify({ threads: THREADS }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function mount(deleteOk = true, onNew = () => {}) {
  vi.stubGlobal("fetch", stubFetch(deleteOk));
  await act(async () => {
    root.render(
      <ThreadList activeId="t1" onNew={onNew} onOpen={() => {}} refreshToken={0} />
    );
  });
  await act(async () => { await Promise.resolve(); });
}

describe("relative time", () => {
  const now = new Date("2026-08-11T12:00:00Z");
  it("reads in the coarse buckets a sidebar needs", () => {
    expect(relativeTime("2026-08-11T11:59:30Z", now)).toBe("just now");
    expect(relativeTime("2026-08-11T11:30:00Z", now)).toBe("30m ago");
    expect(relativeTime("2026-08-11T09:00:00Z", now)).toBe("3h ago");
    expect(relativeTime("2026-08-09T12:00:00Z", now)).toBe("2d ago");
  });

  it("falls back to a date rather than an ever-growing day count", () => {
    expect(relativeTime("2026-07-01T12:00:00Z", now)).toMatch(/Jul/);
  });

  it("says nothing rather than NaN for an unusable timestamp", () => {
    expect(relativeTime("not-a-date", now)).toBe("");
  });
});

describe("the rail", () => {
  it("lists the user's conversations with their titles", async () => {
    await mount();
    expect(container.textContent).toContain("Summarize my Drive");
    expect(container.textContent).toContain("Chat on Aug 3");
  });

  it("offers a way to start a new chat", async () => {
    await mount();
    expect(container.textContent).toContain("New chat");
  });

  it("removes a conversation the server confirms is deleted", async () => {
    await mount(true);
    const del = [...container.querySelectorAll("button")].find((b) =>
      b.getAttribute("aria-label")?.startsWith("Delete Summarize")
    );
    expect(del, "no delete control").toBeTruthy();
    await act(async () => { del!.click(); await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).not.toContain("Summarize my Drive");
  });

  it("KEEPS a conversation the server refused to delete", async () => {
    // The failure that matters: dropping the row optimistically would show the
    // user a deletion that did not happen, and the conversation reappears on
    // the next load. Delete means gone, so nothing leaves the list until the
    // server says it is gone.
    await mount(false);
    const del = [...container.querySelectorAll("button")].find((b) =>
      b.getAttribute("aria-label")?.startsWith("Delete Summarize")
    );
    await act(async () => { del!.click(); await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain("Summarize my Drive");
  });

  it("starts a new chat when the conversation being viewed is deleted", async () => {
    const onNew = vi.fn();
    await mount(true, onNew);
    const del = [...container.querySelectorAll("button")].find((b) =>
      b.getAttribute("aria-label")?.startsWith("Delete Summarize")
    );
    await act(async () => { del!.click(); await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    // t1 was the active thread; leaving it on screen after deleting it would
    // let the user keep typing into a conversation that no longer exists.
    expect(onNew).toHaveBeenCalled();
  });
});
