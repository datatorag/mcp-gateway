// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * `/dashboard/connections` renders the connection card list (SCRUM-482). It
 * was a bare redirect to `/dashboard` that forwarded its query string; the
 * redirect is gone and the page checks the session itself.
 */

const session = vi.hoisted(() => ({ userId: "u1" as string | null }));
vi.mock("@/lib/session", () => ({ getSessionUserId: async () => session.userId }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/dashboard/connections",
}));
vi.mock("posthog-js", () => ({ default: { capture: () => {} } }));

const { default: ConnectionsPage } = await import("./page");
const { ConnectionsClient } = await import("./connections-client");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  session.userId = "u1";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ accounts: [], connections: [], launchedServices: ["google-workspace", "atlassian"] }), {
        status: 200,
      })
    )
  );
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

describe("/dashboard/connections (SCRUM-482)", () => {
  it("renders the connections client for a signed-in user instead of redirecting", async () => {
    const el = await ConnectionsPage();
    expect(el.type).toBe(ConnectionsClient);
  });

  it("sends a visitor with no session to sign in", async () => {
    session.userId = null;
    await expect(ConnectionsPage()).rejects.toThrow("redirect:/auth/login");
  });

  it("no longer forwards to /dashboard", () => {
    const src = readFileSync(join(import.meta.dirname, "page.tsx"), "utf8");
    expect(src).not.toMatch(/connectionsForwardPath|redirect\(\s*["'`]\/dashboard["'`?]/);
  });

  it("renders the connection card list with its connect buttons", async () => {
    await act(async () => {
      root.render(<ConnectionsClient />);
    });
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    expect(container.querySelector("h1")?.textContent).toBe("Connections");
    const cards = container.querySelector("[data-connection-cards]");
    expect(cards).not.toBeNull();
    const titles = Array.from(cards!.querySelectorAll('[data-slot="card-title"]')).map((t) => t.textContent);
    expect(titles).toEqual(["Google Workspace", "Atlassian"]);
    expect(cards!.querySelector('a[href^="/auth/google/connect"]')).not.toBeNull();
  });
});
