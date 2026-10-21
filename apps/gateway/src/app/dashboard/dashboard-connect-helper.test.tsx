// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ConnectedAccount } from "./connections/types";

/**
 * The Google card's connect note sits INSIDE the card footer, under the
 * buttons it explains (SCRUM-434). It used to be rendered after the footer,
 * whose muted band ends in its own rounded corners, so the note hung below
 * the card as a detached strip. Rendered here through the real dashboard
 * client, with only its data hooks stubbed.
 */

const state = vi.hoisted(() => ({ accounts: [] as unknown[] }));
vi.mock("./use-connections", () => ({
  useConnections: () => ({
    accounts: state.accounts,
    legacyConnections: [],
    setAccounts: () => {},
    setLegacyConnections: () => {},
    loaded: true,
    refetch: async () => {},
    hasConnectedAccount: state.accounts.length > 0,
  }),
}));
vi.mock("./use-signup-conversion", () => ({ useSignupConversion: () => {} }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/dashboard",
}));
vi.mock("posthog-js", () => ({ default: { capture: () => {} } }));

import { resetCurrentUserForTests } from "@/lib/use-current-user";
import { DashboardClient } from "./dashboard-client";

let container: HTMLDivElement;
let root: Root;

const GOOGLE_ACCOUNT: ConnectedAccount = {
  id: "acct-1",
  connectorType: "google-workspace",
  label: null,
  accountEmail: "someone@example.com",
  isDefault: true,
  createdAt: "2026-10-01T00:00:00Z",
  scopes: null,
  connectedAt: "2026-10-01T00:00:00Z",
  scopeStatus: { missing: [], complete: true, services: [] },
};

async function render() {
  await act(async () => {
    root.render(<DashboardClient />);
  });
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

beforeEach(() => {
  resetCurrentUserForTests();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) =>
      String(url).includes("/api/me")
        ? new Response(JSON.stringify({ user: { id: "u1", email: "a@example.com", name: null, avatarUrl: null, connectHelperDismissed: false } }), { status: 200 })
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

describe("the Google card's connect note", () => {
  it.each([
    ["before any account is connected", []],
    ["with an account connected (under Add account)", [GOOGLE_ACCOUNT]],
  ])("sits inside the card footer, under the buttons, %s", async (_label, accounts) => {
    state.accounts = accounts;
    await render();
    const note = container.querySelector("[data-connect-helper]");
    expect(note, "the note rendered").not.toBeNull();
    const footer = note!.closest('[data-slot="card-footer"]');
    expect(footer, "the note is inside a card footer").not.toBeNull();
    // Under the buttons, not beside them: the buttons come first in the footer.
    const firstLink = footer!.querySelector("a");
    expect(firstLink).not.toBeNull();
    expect(firstLink!.compareDocumentPosition(note!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Nothing of the card is rendered after its footer.
    expect(footer!.nextElementSibling).toBeNull();
    // One dismiss control.
    expect(note!.querySelectorAll("button")).toHaveLength(1);
  });
});
