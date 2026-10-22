// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * SCRUM-435: on the dashboard, a Google connect link opens the consent
 * instructions as a modal instead of navigating to the route-level page.
 * The rule is pinned on the pure function; the wiring is pinned through the
 * real dashboard client's own Connect link, with only its data hooks stubbed.
 */

const state = vi.hoisted(() => ({ captured: [] as string[] }));
vi.mock("./use-connections", () => ({
  useConnections: () => ({
    accounts: [],
    legacyConnections: [],
    setAccounts: () => {},
    setLegacyConnections: () => {},
    loaded: true,
    refetch: async () => {},
    hasConnectedAccount: false,
  }),
}));
vi.mock("./use-signup-conversion", () => ({ useSignupConversion: () => {} }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/dashboard",
}));
vi.mock("posthog-js", () => ({ default: { capture: (name: string) => state.captured.push(name) } }));

import { resetCurrentUserForTests } from "@/lib/use-current-user";
import { DashboardClient } from "./dashboard-client";
import { GoogleConnectModalHost, googleConnectModalTarget } from "./google-connect-modal";
import { CONSENT_STEPS, INTERSTITIAL_ANNOTATION, INTERSTITIAL_CTA } from "@/gateway/connect-interstitial";

const ORIGIN = "http://localhost:3000";
const PLAIN = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };

function anchor(href: string, target = ""): HTMLAnchorElement {
  const a = document.createElement("a");
  a.href = new URL(href, ORIGIN).toString();
  a.target = target;
  return a;
}

describe("googleConnectModalTarget", () => {
  it("takes a plain click on the connect route and adds proceed, keeping what the link carried", () => {
    expect(
      googleConnectModalTarget(PLAIN, anchor("/auth/google/connect?next=%2Fdashboard%2Fagent&dtr_sid=s1"), ORIGIN)
    ).toBe("/auth/google/connect?next=%2Fdashboard%2Fagent&dtr_sid=s1&proceed=1");
    expect(googleConnectModalTarget(PLAIN, anchor("/auth/google/connect"), ORIGIN)).toBe(
      "/auth/google/connect?proceed=1"
    );
  });

  it("leaves everything else to navigate as before", () => {
    const connect = anchor("/auth/google/connect");
    for (const modifier of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
      expect(googleConnectModalTarget({ ...PLAIN, [modifier]: true }, connect, ORIGIN)).toBeNull();
    }
    expect(googleConnectModalTarget({ ...PLAIN, button: 1 }, connect, ORIGIN)).toBeNull();
    expect(googleConnectModalTarget({ ...PLAIN, defaultPrevented: true }, connect, ORIGIN)).toBeNull();
    expect(googleConnectModalTarget(PLAIN, anchor("/auth/google/connect", "_blank"), ORIGIN)).toBeNull();
    expect(googleConnectModalTarget(PLAIN, anchor("/auth/google/connect?proceed=1"), ORIGIN)).toBeNull();
    expect(googleConnectModalTarget(PLAIN, anchor("/auth/google/connect?refused=1"), ORIGIN)).toBeNull();
    expect(googleConnectModalTarget(PLAIN, anchor("/auth/atlassian/connect"), ORIGIN)).toBeNull();
    expect(googleConnectModalTarget(PLAIN, anchor("https://evil.example/auth/google/connect"), ORIGIN)).toBeNull();
  });
});

describe("the modal on the dashboard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetCurrentUserForTests();
    state.captured = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) =>
        String(url).includes("/api/me")
          ? new Response(JSON.stringify({ user: { id: "u1", email: "a@example.com", name: null, avatarUrl: null, connectHelperDismissed: true } }), { status: 200 })
          : new Response("{}", { status: 200 })
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

  it("opens over the page from the Google card's Connect link, with the real steps and a Continue that proceeds", async () => {
    await act(async () => {
      root.render(
        <>
          <DashboardClient />
          <GoogleConnectModalHost />
        </>
      );
    });
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }

    const link = [...container.querySelectorAll<HTMLAnchorElement>("a")].find(
      (a) => new URL(a.href).pathname === "/auth/google/connect"
    );
    expect(link, "the Google card renders a connect link").toBeTruthy();
    expect(document.querySelector("[data-google-connect-modal]")).toBeNull();

    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    await act(async () => {
      link!.dispatchEvent(click);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(click.defaultPrevented, "the click did not navigate").toBe(true);
    const modal = document.querySelector("[data-google-connect-modal]");
    expect(modal, "the modal opened").not.toBeNull();

    const images = [...modal!.querySelectorAll("img")];
    expect(images.map((img) => img.getAttribute("src"))).toEqual(CONSENT_STEPS.map((s) => s.src));
    for (const img of images) {
      expect(Number(img.getAttribute("width"))).toBeGreaterThan(0);
      expect(Number(img.getAttribute("height"))).toBeGreaterThan(0);
    }
    expect(modal!.querySelector("[data-select-all-mark]")?.textContent).toBe(INTERSTITIAL_ANNOTATION);

    const cont = [...modal!.querySelectorAll<HTMLAnchorElement>("a")].find(
      (a) => a.textContent === INTERSTITIAL_CTA
    );
    const proceed = new URL(cont!.href);
    expect(proceed.pathname).toBe("/auth/google/connect");
    expect(proceed.searchParams.get("proceed")).toBe("1");
  });
});
