// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ConnectedAccount } from "./connections/types";

/**
 * SCRUM-436 on the connections overview: two Notion workspaces under one
 * email read as two different rows, each named by its workspace, with the
 * email beneath; the Notion card says how to reach another workspace or
 * login. Rendered through the real dashboard client, its data hooks stubbed.
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
    launchedServices: ["google-workspace", "atlassian", "notion"],
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
import { NOTION_CONNECT_HELPER_TEXT } from "./connect-helper";

let container: HTMLDivElement;
let root: Root;

const EMAIL = "person@example.com";
const COMPLETE = { missing: [], complete: true, services: [] };

function account(over: Partial<ConnectedAccount>): ConnectedAccount {
  return {
    id: "acct",
    connectorType: "notion",
    label: null,
    externalAccountId: null,
    accountEmail: EMAIL,
    isDefault: false,
    createdAt: "2026-10-01T00:00:00Z",
    scopes: null,
    connectedAt: "2026-10-01T00:00:00Z",
    scopeStatus: COMPLETE,
    ...over,
  };
}

const ACME = account({ id: "n1", label: "Acme Team", externalAccountId: "ws-acme", isDefault: true });
const PERSONAL = account({ id: "n2", label: "Personal Space", externalAccountId: "ws-personal" });
const UNNAMED = account({ id: "n3", label: null, externalAccountId: "ws-unnamed" });
const GOOGLE = account({
  id: "g1",
  connectorType: "google-workspace",
  label: "Work",
  accountEmail: "someone@example.com",
  isDefault: true,
});

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

function card(title: string): HTMLElement {
  const heading = Array.from(container.querySelectorAll('[data-slot="card-title"]')).find(
    (el) => el.textContent === title
  );
  expect(heading, `${title} card`).toBeTruthy();
  return heading!.closest('[data-slot="card"]') as HTMLElement;
}

/** Each account row of a card, as [primary, secondary, isDefault]. */
function rows(el: HTMLElement): Array<[string, string | null, boolean]> {
  return Array.from(el.querySelectorAll("[data-account-row]")).map((row) => [
    row.querySelector("[data-account-primary]")!.textContent!,
    row.querySelector("[data-account-secondary]")?.textContent ?? null,
    Array.from(row.querySelectorAll("span")).some((b) => b.textContent === "Default"),
  ]);
}

beforeEach(() => {
  resetCurrentUserForTests();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) =>
      String(url).includes("/api/me")
        ? new Response(
            JSON.stringify({ user: { id: "u1", email: "a@example.com", name: null, avatarUrl: null, connectHelperDismissed: false } }),
            { status: 200 }
          )
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

describe("Notion rows on the connections overview (SCRUM-436)", () => {
  it("names each workspace first, the shared email second, Default on the right row", async () => {
    state.accounts = [ACME, PERSONAL, GOOGLE];
    await render();
    expect(rows(card("Notion"))).toEqual([
      ["Acme Team", EMAIL, true],
      ["Personal Space", EMAIL, false],
    ]);
  });

  it("falls back to the email for a Notion row with no name", async () => {
    state.accounts = [ACME, UNNAMED];
    await render();
    expect(rows(card("Notion"))).toEqual([
      ["Acme Team", EMAIL, true],
      [EMAIL, null, false],
    ]);
  });

  it("leaves a Google row as it was: the email alone, its label not shown", async () => {
    state.accounts = [ACME, GOOGLE];
    await render();
    expect(rows(card("Google Workspace"))).toEqual([["someone@example.com", null, true]]);
    const row = card("Google Workspace").querySelector("[data-account-row]")!;
    expect(row.textContent).not.toMatch(/\bWork\b/);
  });

  it("names the workspace in the set-default step", async () => {
    state.accounts = [ACME, PERSONAL];
    await render();
    const button = Array.from(card("Notion").querySelectorAll("button")).find(
      (b) => b.textContent === "Set default"
    )!;
    act(() => button.click());
    expect(card("Notion").textContent).toContain(`Make Personal Space (${EMAIL}) the default account?`);
  });

  it("renders a hostile workspace name as text, never as markup", async () => {
    const hostile = '<img src=x onerror="alert(1)"><b>Evil</b>';
    state.accounts = [account({ id: "h1", label: hostile, externalAccountId: "ws-h", isDefault: true })];
    await render();
    const notion = card("Notion");
    // The card has its own brand-mark images; none of them came from the name.
    expect(notion.querySelector('img[src="x"], [onerror]')).toBeNull();
    expect(notion.querySelector("b")).toBeNull();
    expect(rows(notion)[0][0]).toBe(hostile);
  });
});

describe("the Notion card's connect note (SCRUM-436)", () => {
  it.each([
    ["before any workspace is connected", []],
    ["with workspaces connected (under Add account)", [ACME, PERSONAL]],
  ])("sits in the Notion card footer, under the buttons, %s", async (_label, accounts) => {
    state.accounts = accounts;
    await render();
    const note = card("Notion").querySelector("[data-notion-connect-helper]");
    expect(note?.textContent).toBe(NOTION_CONNECT_HELPER_TEXT);
    const footer = note!.closest('[data-slot="card-footer"]')!;
    expect(footer).not.toBeNull();
    const firstLink = footer.querySelector("a")!;
    expect(firstLink.compareDocumentPosition(note!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is not on the Atlassian or Google card", async () => {
    state.accounts = [];
    await render();
    expect(card("Atlassian").querySelector("[data-notion-connect-helper]")).toBeNull();
    expect(card("Google Workspace").querySelector("[data-notion-connect-helper]")).toBeNull();
    expect(container.querySelectorAll("[data-notion-connect-helper]")).toHaveLength(1);
  });
});
