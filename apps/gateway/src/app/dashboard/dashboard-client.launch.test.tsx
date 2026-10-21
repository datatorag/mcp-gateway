// @vitest-environment jsdom

/**
 * SCRUM-366: the dashboard's service cards follow the launch gate. Notion's
 * connect flow ships before its registry rows, so its card appears only when
 * the connections view says Notion has launched; Google and Atlassian are
 * always there.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

const { DashboardClient } = await import("./dashboard-client");

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
  vi.unstubAllGlobals();
});

async function mountWith(view: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).includes("/api/connections")
        ? new Response(JSON.stringify(view), { status: 200 })
        : new Response("{}", { status: 200 })
    )
  );
  act(() => root.render(<DashboardClient />));
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const cardTitles = () =>
  Array.from(container.querySelectorAll('[data-slot="card-title"]')).map(
    (el) => (el.textContent ?? "").trim()
  );

describe("dashboard service cards and the launch gate (SCRUM-366)", () => {
  it("shows no Notion card while Notion has not launched", async () => {
    await mountWith({
      accounts: [],
      connections: [],
      launchedServices: ["google-workspace", "atlassian"],
    });
    expect(cardTitles()).toEqual(expect.arrayContaining(["Google Workspace", "Atlassian"]));
    expect(cardTitles()).not.toContain("Notion");
    expect(container.querySelector('a[href^="/auth/notion/connect"]')).toBeNull();
  });

  it("shows no Notion card from a response that carries no launched set", async () => {
    await mountWith({ accounts: [], connections: [] });
    expect(cardTitles()).toContain("Google Workspace");
    expect(cardTitles()).not.toContain("Notion");
  });

  it("shows the Notion card, with its connect link, once launched", async () => {
    await mountWith({
      accounts: [],
      connections: [],
      launchedServices: ["google-workspace", "atlassian", "notion"],
    });
    expect(cardTitles()).toEqual(
      expect.arrayContaining(["Google Workspace", "Atlassian", "Notion"])
    );
    expect(container.querySelector('a[href^="/auth/notion/connect"]')).not.toBeNull();
  });
});
