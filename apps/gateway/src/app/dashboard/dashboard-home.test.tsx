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
  it("renders the headline, prompts, client cards, full steps, MCP card and status strip, in that order", async () => {
    await render();
    expect(qa("[data-section]").map((s) => s.getAttribute("data-section"))).toEqual([
      "hero",
      "prompts",
      "clients",
      "steps",
      "mcp",
      "status",
    ]);
  });

  it("no longer carries the connection card list, which lives on /dashboard/connections", async () => {
    await render();
    expect(q("[data-connection-cards]")).toBeNull();
  });

  it("has one call to action, Connect my agent, pointing at the client cards", async () => {
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

describe("client cards", () => {
  it("lists every client, grouped Claude, ChatGPT and Codex, Cursor", async () => {
    await render();
    expect(qa("[data-client-group]").map((g) => g.getAttribute("data-client-group"))).toEqual([
      "claude",
      "openai",
      "cursor",
    ]);
    expect(qa("[data-client-card]").map((c) => c.getAttribute("data-client-card"))).toEqual(
      MCP_CLIENTS.map((c) => c.id)
    );
    expect(
      qa('[data-client-group="claude"] [data-client-card]').map((c) => c.getAttribute("data-client-card"))
    ).toEqual(["claude-web", "claude-desktop", "claude-code"]);
  });

  it("links each card to its full steps on this page (SCRUM-487)", async () => {
    await render();
    for (const c of MCP_CLIENTS) {
      const link = q(`[data-client-card="${c.id}"] a[href^="/dashboard#"]`);
      expect(link?.getAttribute("href")).toBe(`/dashboard#${c.id}`);
    }
  });

  it("copies the client's exact config with this origin's URL, and reports it under both events", async () => {
    await render();
    const url = `${window.location.origin}/mcp`;
    const button = Array.from(
      q('[data-client-card="claude-code"]')!.querySelectorAll("button")
    ).find((b) => b.textContent?.includes("Copy"))!;
    await act(async () => {
      button.click();
    });
    expect(clipboard.writeText).toHaveBeenCalledWith(clientConfig("claude-code", url));
    expect(state.capture).toHaveBeenCalledWith(EVENTS.CLIENT_CARD_INSTALL_CLICKED, {
      client: "claude-code",
      action: "copy",
    });
    expect(state.capture).toHaveBeenCalledWith(EVENTS.COPY_MCP_CONFIG, {
      source: "home_claude-code",
      surface: "home",
    });
  });

  it("reports nothing when the clipboard refuses the write", async () => {
    clipboard.writeText.mockRejectedValueOnce(new Error("denied"));
    await render();
    const button = q('[data-client-card="chatgpt"] button')!as HTMLButtonElement;
    await act(async () => {
      button.click();
    });
    expect(state.capture).not.toHaveBeenCalled();
  });

  it("gives Cursor its install deep link, and the click carries the client", async () => {
    await render();
    const install = q('[data-client-card="cursor"] a[href^="cursor://"]') as HTMLAnchorElement;
    expect(install.textContent).toBe("Install");
    install.addEventListener("click", (e) => e.preventDefault());
    act(() => install.click());
    expect(state.capture).toHaveBeenCalledWith(EVENTS.CLIENT_CARD_INSTALL_CLICKED, {
      client: "cursor",
      action: "deep_link",
    });
    // No other client claims a deep link it does not have.
    expect(qa('[data-client-card] a[href^="cursor://"]').length).toBe(1);
  });
});

describe("the order rule", () => {
  it("with nothing connected, shows the client cards AND the connect step, saying one account comes first", async () => {
    await render();
    expect(qa("[data-client-card]").length).toBe(MCP_CLIENTS.length);
    const note = q("[data-connect-first]")!;
    expect(note.textContent).toMatch(/at least one account before/);
    expect(note.querySelector('a[href="/dashboard/connections"]')).not.toBeNull();
    expect(qa("[data-status-chip]").length).toBeGreaterThan(0);
  });

  it("drops the note once an account is connected, and keeps the client cards", async () => {
    state.accounts = [account()];
    await render();
    expect(q("[data-connect-first]")).toBeNull();
    expect(qa("[data-client-card]").length).toBe(MCP_CLIENTS.length);
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
describe("step-by-step setup", () => {
  it("offers every client's full steps and the connection status", async () => {
    await render();
    const steps = q('[data-section="steps"]')!;
    expect(steps.id).toBe("setup-steps");
    const tabs = Array.from(steps.querySelectorAll("button")).map((b) => b.textContent);
    for (const c of MCP_CLIENTS) expect(tabs).toContain(c.label);
    expect(steps.textContent).toContain("Connection status");
  });

  it("copy_mcp_config keeps the wizard source and settings surface the MCP config page sent", async () => {
    await render();
    const steps = q('[data-section="steps"]')!;
    const tab = Array.from(steps.querySelectorAll("button")).find((b) => b.textContent === "Claude Code")!;
    await act(async () => {
      tab.click();
    });
    const copy = Array.from(steps.querySelectorAll("button")).find((b) => b.textContent === "Copy")!;
    await act(async () => {
      copy.click();
    });
    expect(clipboard.writeText).toHaveBeenCalledWith(clientConfig("claude-code", `${window.location.origin}/mcp`));
    expect(state.capture).toHaveBeenCalledWith(EVENTS.COPY_MCP_CONFIG, {
      source: "wizard_claude-code",
      surface: "settings",
    });
  });

  it("a card's Full steps link opens that client's steps on the same page", async () => {
    await render();
    window.location.hash = "#cursor";
    await act(async () => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    const panel = q('[data-section="steps"] #cursor');
    expect(panel?.textContent).toContain("Cursor");
    window.location.hash = "";
  });
});

