// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ConnectedAccount } from "../types";

/**
 * SCRUM-436 on the service detail page: the page Manuel was on. Two Notion
 * workspaces under one email are named by workspace, the email beneath, and
 * the page says how to reach another workspace or Notion login.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));
vi.mock("posthog-js", () => ({ default: { capture: () => {} } }));

import { resetCurrentUserForTests } from "@/lib/use-current-user";
import { ConnectionDetailClient } from "./client";
import { NOTION_CONNECT_HELPER_TEXT } from "../../connect-helper";
import { GRANT_UNRECORDED } from "../grant-copy";

const EMAIL = "person@example.com";
const COMPLETE = { missing: [], complete: true, services: [] };
/** What the server sends for a Notion row (SCRUM-436): no scope grant. */
const NOTION_GRANT = { ...COMPLETE, scoped: false };

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
    scopeStatus: over.connectorType && over.connectorType !== "notion" ? COMPLETE : NOTION_GRANT,
    ...over,
  };
}

const ACME = account({ id: "n1", label: "Acme Team", externalAccountId: "ws-acme", isDefault: true });
const PERSONAL = account({ id: "n2", label: "Personal Space", externalAccountId: "ws-personal" });
const UNNAMED = account({ id: "n3", label: null, externalAccountId: "ws-unnamed" });
const GOOGLE_A = account({
  id: "g1",
  connectorType: "google-workspace",
  label: "Work",
  accountEmail: "someone@example.com",
  isDefault: true,
});
const GOOGLE_B = account({
  id: "g2",
  connectorType: "google-workspace",
  accountEmail: "other@example.com",
});

let container: HTMLDivElement;
let root: Root;
let accounts: ConnectedAccount[];

async function render(service: string, connectUrl: string) {
  await act(async () => {
    root.render(<ConnectionDetailClient service={service} connectUrl={connectUrl} />);
  });
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** Each account row, as [primary, secondary, isDefault]. */
function rows(): Array<[string, string | null, boolean]> {
  return Array.from(container.querySelectorAll("[data-account-row]")).map((row) => [
    row.querySelector("[data-account-primary]")!.textContent!,
    row.querySelector("[data-account-secondary]")?.textContent ?? null,
    Array.from(row.querySelectorAll("span")).some((s) => s.textContent === "Default"),
  ]);
}

beforeEach(() => {
  resetCurrentUserForTests();
  accounts = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      const target = String(url);
      if (target === "/api/connections") {
        return new Response(JSON.stringify({ accounts, connections: [] }), { status: 200 });
      }
      if (target.startsWith("/api/playground/tools")) {
        return new Response(JSON.stringify({ tools: [] }), { status: 200 });
      }
      if (target.includes("/api/me")) {
        return new Response(
          JSON.stringify({ user: { id: "u1", email: "a@example.com", name: null, avatarUrl: null, connectHelperDismissed: false } }),
          { status: 200 }
        );
      }
      return new Response("{}", { status: 200 });
    })
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

describe("Notion rows on the service detail page (SCRUM-436)", () => {
  it("names each workspace first, the shared email second, Default on the right row", async () => {
    accounts = [ACME, PERSONAL];
    await render("notion", "/auth/notion/connect");
    expect(rows()).toEqual([
      ["Acme Team", EMAIL, true],
      ["Personal Space", EMAIL, false],
    ]);
    // Notion grants no scopes: no "predates grant recording" note.
    expect(container.textContent).not.toContain(GRANT_UNRECORDED);
    // The name is not said twice: the label chip is for rows without one.
    expect(container.textContent!.split("Acme Team")).toHaveLength(2);
  });

  it("falls back to the email for a Notion row with no name", async () => {
    accounts = [ACME, UNNAMED];
    await render("notion", "/auth/notion/connect");
    expect(rows()).toEqual([
      ["Acme Team", EMAIL, true],
      [EMAIL, null, false],
    ]);
  });

  it("names the workspace in the set-default step", async () => {
    accounts = [ACME, PERSONAL];
    await render("notion", "/auth/notion/connect");
    const button = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Set default"
    )!;
    act(() => button.click());
    expect(container.textContent).toContain(`Make Personal Space (${EMAIL}) the default account?`);
  });

  it("renders a hostile workspace name as text, never as markup", async () => {
    const hostile = '<img src=x onerror="alert(1)"><b>Evil</b>';
    accounts = [account({ id: "h1", label: hostile, externalAccountId: "ws-h", isDefault: true })];
    await render("notion", "/auth/notion/connect");
    expect(container.querySelector('img[src="x"], [onerror]')).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(rows()[0][0]).toBe(hostile);
  });

  it("says how to reach another workspace, under Add account", async () => {
    accounts = [ACME, PERSONAL];
    await render("notion", "/auth/notion/connect");
    const note = container.querySelector("[data-notion-connect-helper]");
    expect(note?.textContent).toBe(NOTION_CONNECT_HELPER_TEXT);
    const add = Array.from(container.querySelectorAll("a")).find((a) => a.textContent === "Add account")!;
    expect(add.compareDocumentPosition(note!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("says it under Connect when nothing is connected yet", async () => {
    await render("notion", "/auth/notion/connect");
    expect(container.querySelector("[data-notion-connect-helper]")?.textContent).toBe(
      NOTION_CONNECT_HELPER_TEXT
    );
  });
});

describe("Google and Atlassian on the service detail page", () => {
  it("leaves Google rows as they were: the email first, a label as its chip", async () => {
    accounts = [GOOGLE_A, GOOGLE_B];
    await render("google-workspace", "/auth/google/connect");
    expect(rows()).toEqual([
      ["someone@example.com", null, true],
      ["other@example.com", null, false],
    ]);
    expect(container.textContent).toContain("Work");
    // A Google row with null scopes still says its grant was not recorded.
    expect(container.textContent).toContain(GRANT_UNRECORDED);
    expect(container.querySelector("[data-notion-connect-helper]")).toBeNull();
  });

  it("puts no Notion note on the Atlassian page", async () => {
    accounts = [account({ id: "a1", connectorType: "atlassian", isDefault: true })];
    await render("atlassian", "/auth/atlassian/connect");
    expect(container.querySelector("[data-notion-connect-helper]")).toBeNull();
    accounts = [];
    act(() => root.unmount());
    root = createRoot(container);
    await render("atlassian", "/auth/atlassian/connect");
    expect(container.querySelector("[data-notion-connect-helper]")).toBeNull();
  });
});
