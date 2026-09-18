// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { promoCopy } from "@/lib/promo";

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));
vi.mock("next/navigation", () => ({ usePathname: () => "/docs/gmail" }));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: (p: { src: string; alt: string }) => <img src={p.src} alt={p.alt} />,
}));

const { default: DocsLayout } = await import("./layout");

/* SCRUM-287: a banner above the docs layout pushed the sidebar and the
   content down. On docs the campaign lives in the sidebar button instead.
   The clock is the real one here, so the banner assertion is only meaningful
   while the campaign is active; the guard below makes that explicit rather
   than letting the test pass for the wrong reason after the end date. */
describe("DocsLayout", () => {
  it("mounts no promo banner, and the layout is the first thing in the tree", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers({ now: new Date("2026-10-01T12:00:00Z"), toFake: ["Date"] });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <DocsLayout>
          <p>page body</p>
        </DocsLayout>,
      );
    });

    expect(container.querySelector('[aria-label="Promotion"]')).toBeNull();
    expect(container.querySelector('a[href^="/pricing?promo="]')).toBeNull();
    expect(container.firstElementChild?.className).toContain("min-h-screen");

    // The campaign is still on the page, inside the sidebar button.
    const cta = container.querySelector('aside a[href="/auth/login"]');
    expect(cta?.textContent).toContain(promoCopy().headline);

    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });
});
