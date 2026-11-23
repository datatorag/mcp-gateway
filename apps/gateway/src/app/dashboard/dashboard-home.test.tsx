// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ConnectedAccount } from "./connections/types";

/**
 * The dashboard home as a connect-your-client page (SCRUM-482). Rendered
 * through the real client with only its data hooks stubbed: the sections and
 * their order, the client cards with their exact configs, the order rule for
 * a user with nothing connected, the status strip, and the events on each
 * moved or new control.
 */

const state = vi.hoisted(() => ({
  accounts: [] as unknown[],
  push: vi.fn(),
  capture: vi.fn(),
}));
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
  useRouter: () => ({ push: state.push, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/dashboard",
}));
vi.mock("posthog-js", () => ({ default: { capture: state.capture } }));

import { DashboardClient, serviceStatus } from "./dashboard-client";
import { EVENTS } from "@/lib/analytics";
import { MCP_CLIENTS, clientConfig } from "@/lib/mcp-clients";

let container: HTMLDivElement;
let root: Root;
const clipboard = { writeText: vi.fn(async () => {}) };

function account(over: Partial<ConnectedAccount> = {}): ConnectedAccount {
  return {
    id: "acct-1",
    connectorType: "google-workspace",
    label: null,
    accountEmail: "someone@example.com",
    isDefault: true,
    createdAt: "2026-10-01T00:00:00Z",
    scopes: null,
    connectedAt: "2026-10-01T00:00:00Z",
    scopeStatus: { missing: [], complete: true, services: [] },
    ...over,
  };
}

async function render() {
  await act(async () => {
    root.render(<DashboardClient />);
  });
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const q = (sel: string) => container.querySelector(sel);
const qa = (sel: string) => Array.from(container.querySelectorAll(sel));

beforeEach(() => {
  state.accounts = [];
  state.push.mockReset();
  state.capture.mockReset();
  clipboard.writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ suggestions: [{ id: "week_calendar", text: "See my week" }] }), { status: 200 }))
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

describe("dashboard home sections (SCRUM-482)", () => {
  it("renders the headline, prompts, client step, MCP card and status strip, in that order", async () => {
    await render();
    expect(qa("[data-section]").map((s) => s.getAttribute("data-section"))).toEqual([
      "hero",
      "prompts",
      "clients",
      "mcp",
      "status",
    ]);
  });

  it("no longer carries the connection card list, which lives on /dashboard/connections", async () => {
    await render();
    expect(q("[data-connection-cards]")).toBeNull();
  });

  it("has one call to action, Connect my agent, pointing at the client step", async () => {
    await render();
    const hero = q('[data-section="hero"]')!;
    const cta = hero.querySelector("a")!;
    expect(cta.textContent).toContain("Connect my agent");
    const target = cta.getAttribute("href")!.slice(1);
    expect(q(`#${target}`)?.getAttribute("data-section")).toBe("clients");
  });

  it("says nothing in an em-dash", async () => {
    await render();
    expect(container.textContent).not.toMatch(/—/);
  });
});

describe("prompt cards", () => {
  it("are locked with the old title until an account is connected, and tagged with service icons", async () => {
    await render();
    const cards = qa("[data-prompt-card]");
    expect(cards.length).toBe(3);
    for (const card of cards) {
      const run = card.querySelector("[data-prompt-run]") as HTMLButtonElement;
      expect(run.disabled).toBe(true);
      expect(run.title).toBe("Connect an account to run this");
      expect(card.querySelectorAll("[data-prompt-icons] img").length).toBeGreaterThan(0);
    }
  });

  it("run into the agent by shape id once connected, with the same event", async () => {
    state.accounts = [account()];
    await render();
    const run = q("[data-prompt-run]") as HTMLButtonElement;
    expect(run.disabled).toBe(false);
    act(() => run.click());
    expect(state.push).toHaveBeenCalledWith("/dashboard/agent?prompt=week_calendar");
    expect(state.capture).toHaveBeenCalledWith(EVENTS.AGENT_SUGGESTION_CLICKED, {
      context: "dashboard",
      shape_id: "week_calendar",
      position: 0,
    });
    // The calendar shape is tagged with the Calendar mark.
    expect(q("[data-prompt-icons] img")?.getAttribute("src")).toBe("/icons/services/calendar.svg");
  });
});

describe("the client step (SCRUM-503)", () => {
  it("is the Add to your agent block, full, signed in, with every client, and the live check under it", async () => {
    await render();
    const section = q('[data-section="clients"]')!;
    expect(section.id).toBe("connect-your-agent");
    const block = section.querySelector('[data-add-to-agent="home"]')!;
    expect(block.getAttribute("data-layout")).toBe("full");
    expect(qa("[data-client]").map((b) => b.getAttribute("data-client"))).toEqual(MCP_CLIENTS.map((c) => c.id));
    // Signed in: no "account later" line.
    expect(block.querySelector("[data-signed-out]")).toBeNull();
    // The live check follows the block, in the same section.
    const status = Array.from(section.querySelectorAll("*")).find((el) => el.textContent === "Connection status")!;
    expect(block.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("replaces the per-client cards and the step-by-step picker: neither is left on the page", async () => {
    await render();
    expect(q("[data-client-card]")).toBeNull();
    expect(q('[data-section="steps"]')).toBeNull();
    expect(qa("[data-add-to-agent]").length).toBe(1);
  });

  it("copies on the home placement, under both events", async () => {
    await render();
    const copy = q('[data-add-to-agent="home"] [data-action="copy"]') as HTMLButtonElement;
    await act(async () => {
      copy.click();
    });
    expect(clipboard.writeText).toHaveBeenCalledWith(clientConfig("claude-web", `${window.location.origin}/mcp`));
    expect(state.capture).toHaveBeenCalledWith(EVENTS.ADD_TO_AGENT_ACTION, {
      placement: "home",
      client: "claude-web",
      action: "copy",
    });
    expect(state.capture).toHaveBeenCalledWith(EVENTS.COPY_MCP_CONFIG, {
      source: "home_claude-web",
      surface: "home",
    });
  });
});

describe("the order rule", () => {
  it("with nothing connected, shows the client step AND the connect step, saying one account comes first", async () => {
    await render();
    expect(q('[data-add-to-agent="home"]')).not.toBeNull();
    const note = q("[data-connect-first]")!;
    expect(note.textContent).toMatch(/at least one account before/);
    expect(note.querySelector('a[href="/dashboard/connections"]')).not.toBeNull();
    expect(qa("[data-status-chip]").length).toBeGreaterThan(0);
  });

  it("drops the note once an account is connected, and keeps the client step", async () => {
    state.accounts = [account()];
    await render();
    expect(q("[data-connect-first]")).toBeNull();
    expect(q('[data-add-to-agent="home"]')).not.toBeNull();
  });
});

describe("MCP card", () => {
  it("shows the server URL with a copy button and the client marks", async () => {
    await render();
    const card = q('[data-section="mcp"]')!;
    expect(card.querySelector("[data-mcp-url]")?.textContent).toBe(`${window.location.origin}/mcp`);
    expect(card.querySelectorAll('img[src^="/icons/clients/"]').length).toBe(4);
    await act(async () => {
      (card.querySelector('button[aria-label="Copy MCP server URL"]') as HTMLButtonElement).click();
    });
    expect(clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/mcp`);
    expect(state.capture).toHaveBeenCalledWith(EVENTS.COPY_MCP_CONFIG, {
      source: "home_url",
      surface: "home",
    });
  });
});

describe("status strip", () => {
  it("one chip per offered provider, each linking to /dashboard/connections", async () => {
    state.accounts = [account()];
    await render();
    const chips = qa("[data-status-chip]");
    expect(chips.map((c) => c.getAttribute("data-status-chip"))).toEqual([
      "google-workspace",
      "atlassian",
      "notion",
    ]);
    for (const chip of chips) expect(chip.getAttribute("href")).toBe("/dashboard/connections");
    expect(q('[data-status-chip="google-workspace"]')?.getAttribute("data-status")).toBe("connected");
    expect(q('[data-status-chip="atlassian"]')?.getAttribute("data-status")).toBe("not_connected");
  });

  it("reads needs reconnecting from the view's refresh state", () => {
    const dead = account({ refresh: { needsReconnect: true, lastError: "invalid_grant" } });
    expect(serviceStatus("google-workspace", [dead], [])).toBe("needs_reconnect");
    expect(serviceStatus("google-workspace", [account()], [])).toBe("connected");
    expect(serviceStatus("atlassian", [account()], [])).toBe("not_connected");
  });
});

/* SCRUM-487: the MCP config page's two parts, the per-client steps and the
 * live connection status, live on Home, and its copy event fires from here
 * with the properties it carried there. */
describe("an old link to a client's steps", () => {
  it("opens that client in the block: /dashboard/mcp-config#cursor still lands on Cursor", async () => {
    window.location.hash = "#cursor";
    await render();
    expect(q('[data-add-to-agent="home"] [aria-pressed="true"]')?.getAttribute("data-client")).toBe("cursor");
    window.location.hash = "";
  });
});

